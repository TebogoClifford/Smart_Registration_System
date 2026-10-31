/*
  srs_door.ino - Smart Registration System door unit (Arduino Mega / Uno / Nano), version 2.

  An HC-SR04 ultrasonic sensor checks that the student stands at the right distance from the
  webcam. Only after they have stayed inside the distance window for HOLD_MS (1 second) does the
  Arduino tell the PC app to take the picture. The PC app answers with the access decision, which
  is shown on a 16x2 I2C LCD with a beep pattern on the buzzer.

  Wiring
    HC-SR04  VCC -> 5V   GND -> GND   TRIG -> D9   ECHO -> D10
    LCD I2C  VCC -> 5V   GND -> GND   SDA  -> pin 20, SCL -> pin 21 (Mega)  /  SDA A4, SCL A5 (Uno, Nano)
    Buzzer   +   -> D8   -   -> GND   (passive buzzer; for an active buzzer set PASSIVE_BUZZER false)

  Library: "LiquidCrystal I2C" by Frank de Brabander (Arduino IDE > Tools > Manage Libraries).
  The LCD is found by itself at I2C address 0x27 or 0x3F. If it stays blank, turn the blue contrast
  screw on its back.

  Serial protocol with the PC app (9600 baud, one message per line)
    Arduino -> PC   HELLO SRS-DOOR v2 LCD=0x27   at start-up (LCD=NONE when no LCD answers)
                    S <cm> <state>   4 times a second: distance (-1 = nothing) and what the unit is doing
                    READY            student held the right distance for 1 s: take the picture now
                    AWAY             student left before a decision arrived: cancel
                    PONG v2          answer to P
                    T ...            hardware test results (see below)
    PC -> Arduino   G / D / A        access granted / denied / already inside
                    P                are you there?
                    TL               test the LCD: look for it on the I2C bus, show a test pattern
                                       -> T LCD OK 0x27   or   T LCD FAIL
                    TB               test the buzzer: three beeps  -> T BUZZER DONE
                    TS               test the distance sensor: 10 readings
                                       -> T SONAR OK <median cm> <good>/10   or   T SONAR FAIL 0/10
                    TX               end the test, back to normal
*/
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ------------------------------------------------------------------ settings
const uint8_t TRIG_PIN = 9;
const uint8_t ECHO_PIN = 10;
const uint8_t BUZZER_PIN = 8;
const bool PASSIVE_BUZZER = true;
const uint8_t LCD_ADDRESSES[] = { 0x27, 0x3F };  // the two usual I2C backpack addresses

const int MIN_CM = 20;                 // closer than this: "step back"
const int MAX_CM = 40;                 // further than this: "come closer" (window centre 30 cm, as on the server)
const int GONE_CM = MAX_CM + 15;       // after a result, the student must step beyond this before the next scan
const unsigned long HOLD_MS = 1000;    // time in the window before the picture is taken
const unsigned long GRACE_MS = 200;    // one stray echo shorter than this does not restart the hold
const unsigned long ANSWER_MS = 6000;  // how long to wait for the PC's decision
const unsigned long RESULT_MS = 3000;  // how long a result stays on the screen
const unsigned long MEASURE_MS = 60;   // HC-SR04 needs ~60 ms between pings
const unsigned long STATUS_MS = 250;   // how often the live status goes to the PC
const unsigned long TEST_MAX_MS = 120000; // a test the PC abandoned ends by itself

LiquidCrystal_I2C *lcd = nullptr;  // created once the LCD is found
uint8_t lcdAddress = 0;

enum State { WAITING, HOLDING, SCANNING, RESULT, LEAVING, TESTING };
const char *STATE_NAMES[] = { "WAITING", "HOLDING", "SCANNING", "RESULT", "LEAVING", "TESTING" };
State state = WAITING;
unsigned long stateSince = 0;     // when the current state began
unsigned long lastInWindow = 0;   // last time a reading was inside the window
unsigned long lastMeasure = 0;
unsigned long lastStatus = 0;
int distanceCm = -1;              // latest reading, -1 = nothing in range
String line1, line2;              // what is on the LCD now (rewritten only when it changes)
String incoming;

// ------------------------------------------------------------------ helpers
// The LCD's I2C address, or 0 when none of the usual addresses answers.
uint8_t findLcd() {
  for (uint8_t a : LCD_ADDRESSES) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) return a;
  }
  return 0;
}

void setupLcd() {
  uint8_t a = findLcd();
  if (a && a != lcdAddress) {
    delete lcd;
    lcd = new LiquidCrystal_I2C(a, 16, 2);
    lcd->init();
    lcd->backlight();
  }
  if (!a) { delete lcd; lcd = nullptr; }
  lcdAddress = a;
  line1 = line2 = "";  // force the next show() to draw
}

String hex2(uint8_t a) { String s = String(a, HEX); s.toUpperCase(); return "0x" + s; }

// One HC-SR04 reading in cm, or -1 when no echo came back (nobody within ~4 m).
int measureCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long us = pulseIn(ECHO_PIN, HIGH, 25000UL);
  return us == 0 ? -1 : (int)(us / 58UL);
}

// Middle of three readings: one odd echo cannot start or stop a scan.
int measureMedianCm() {
  int a = measureCm(); delay(10);
  int b = measureCm(); delay(10);
  int c = measureCm();
  if (a < 0) a = 999;
  if (b < 0) b = 999;
  if (c < 0) c = 999;
  int m = max(min(a, b), min(max(a, b), c));
  return m == 999 ? -1 : m;
}

bool inWindow(int cm) { return cm >= MIN_CM && cm <= MAX_CM; }

void show(const String &top, const String &bottom) {
  if (!lcd || (top == line1 && bottom == line2)) return;  // no LCD, or avoid flicker
  line1 = top; line2 = bottom;
  lcd->clear();
  lcd->setCursor(0, 0); lcd->print(top.substring(0, 16));
  lcd->setCursor(0, 1); lcd->print(bottom.substring(0, 16));
}

void beep(unsigned int hz, unsigned int ms) {
  if (PASSIVE_BUZZER) { tone(BUZZER_PIN, hz, ms); delay(ms); noTone(BUZZER_PIN); }
  else { digitalWrite(BUZZER_PIN, HIGH); delay(ms); digitalWrite(BUZZER_PIN, LOW); }
}

void beepCapture() { beep(2000, 80); }
void beepGranted() { beep(1500, 120); delay(60); beep(2200, 180); }
void beepDenied()  { beep(400, 700); }
void beepNoAnswer() { beep(800, 150); delay(80); beep(800, 150); }

void enter(State s) { state = s; stateSince = millis(); }

// "####......" progress bar for the 1-second hold.
String holdBar(unsigned long held) {
  int filled = (int)min(16UL, held * 16UL / HOLD_MS);
  String bar;
  for (int i = 0; i < 16; i++) bar += (i < filled ? (char)255 : '.');
  return bar;
}

String distanceText(int cm) { return cm < 0 ? String("---") : String(cm) + "cm"; }

// One complete line from the PC, or "" when none has arrived yet.
String readCommand() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      String line = incoming;
      incoming = "";
      line.trim();
      if (line.length()) return line;
    } else if (incoming.length() < 16) {
      incoming += c;
    }
  }
  return "";
}

// ------------------------------------------------------------------ hardware test (commands from the PC)
void testLcd() {
  setupLcd();
  if (!lcdAddress) { Serial.println("T LCD FAIL"); return; }
  String blocks;
  for (int i = 0; i < 16; i++) blocks += (char)255;
  show("LCD TEST " + hex2(lcdAddress), blocks);
  Serial.println("T LCD OK " + hex2(lcdAddress));
}

void testBuzzer() {
  show("Buzzer test", "3 beeps...");
  for (int i = 0; i < 3; i++) { beep(1000 + i * 500, 200); delay(150); }
  Serial.println("T BUZZER DONE");
}

void testSonar() {
  int values[10], good = 0;
  for (int i = 0; i < 10; i++) {
    int cm = measureCm();
    if (cm > 0) values[good++] = cm;
    delay(MEASURE_MS);
  }
  if (!good) { show("Distance test", "no echo"); Serial.println("T SONAR FAIL 0/10"); return; }
  for (int i = 1; i < good; i++)  // sort, for the median
    for (int j = i; j > 0 && values[j] < values[j - 1]; j--) { int t = values[j]; values[j] = values[j - 1]; values[j - 1] = t; }
  int median = values[good / 2];
  show("Distance test", String(median) + "cm " + String(good) + "/10 ok");
  Serial.println("T SONAR OK " + String(median) + " " + String(good) + "/10");
}

void handleTestCommand(const String &cmd) {
  if (cmd == "TX") { enter(WAITING); line1 = line2 = ""; return; }
  if (state != TESTING) enter(TESTING);
  stateSince = millis();
  if (cmd == "TL") testLcd();
  else if (cmd == "TB") testBuzzer();
  else if (cmd == "TS") testSonar();
}

// ------------------------------------------------------------------ main program
void setup() {
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  Serial.begin(9600);
  Wire.begin();
  setupLcd();
  show("Smart Register", "Starting...");
  beep(1800, 60);
  delay(800);
  Serial.println(String("HELLO SRS-DOOR v2 LCD=") + (lcdAddress ? hex2(lcdAddress) : String("NONE")));
  enter(WAITING);
}

void loop() {
  unsigned long now = millis();
  String cmd = readCommand();
  char decision = 0;
  if (cmd == "P") Serial.println("PONG v2");
  else if (cmd.startsWith("T")) handleTestCommand(cmd);
  else if (cmd == "G" || cmd == "D" || cmd == "A") decision = cmd[0];

  if (now - lastMeasure >= MEASURE_MS) {
    lastMeasure = now;
    distanceCm = measureMedianCm();
    if (inWindow(distanceCm)) lastInWindow = millis();
  }
  now = millis();
  if (now - lastStatus >= STATUS_MS) {  // live status for the PC app's Hardware panel
    lastStatus = now;
    Serial.print("S "); Serial.print(distanceCm); Serial.print(' '); Serial.println(STATE_NAMES[state]);
  }
  bool present = now - lastInWindow <= GRACE_MS;  // in the window, allowing one stray echo

  switch (state) {
    case WAITING:
      if (present) { enter(HOLDING); break; }
      if (distanceCm >= 0 && distanceCm < MIN_CM) show("Too close", "Step back  " + distanceText(distanceCm));
      else if (distanceCm >= 0 && distanceCm <= GONE_CM) show("Come closer", "Stand at " + String(MIN_CM) + "-" + String(MAX_CM) + "cm");
      else show("Smart Register", "Step up to scan");
      break;

    case HOLDING:
      if (!present) { enter(WAITING); break; }
      if (now - stateSince >= HOLD_MS) {
        Serial.println("READY");  // the PC app takes the picture now
        beepCapture();
        show("Scanning face...", "Look at camera");
        enter(SCANNING);
      } else {
        show("Hold still " + distanceText(distanceCm), holdBar(now - stateSince));
      }
      break;

    case SCANNING:
      if (decision == 'G') { show("ACCESS GRANTED", "Welcome, go in"); beepGranted(); enter(RESULT); break; }
      if (decision == 'D') { show("ACCESS DENIED", "See invigilator"); beepDenied(); enter(RESULT); break; }
      if (decision == 'A') { show("ALREADY INSIDE", "Entry recorded"); beepNoAnswer(); enter(RESULT); break; }
      if (now - stateSince > ANSWER_MS) {
        Serial.println("AWAY");
        show("No answer", "Please try again");
        beepNoAnswer();
        enter(RESULT);
        break;
      }
      if (now - lastInWindow > 1500) {  // walked off: cancel the scan
        Serial.println("AWAY");
        enter(WAITING);
      }
      break;

    case RESULT:
      if (now - stateSince >= RESULT_MS) enter(LEAVING);  // a late answer keeps showing the first one
      break;

    case LEAVING:
      // the same student must step away before the next scan, so one person is not scanned twice
      if (distanceCm < 0 || distanceCm > GONE_CM) enter(WAITING);
      else show("Next student", "Step away first");
      break;

    case TESTING:
      // the PC app drives the test; the LCD keeps the test screen. A test left running ends by itself.
      if (now - stateSince > TEST_MAX_MS) { enter(WAITING); line1 = line2 = ""; }
      break;
  }
}
