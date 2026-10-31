/*
  srs_door.ino - Smart Registration System door unit (Arduino Uno / Nano).

  An HC-SR04 ultrasonic sensor checks that the student stands at the right distance from the
  webcam. Only after they have stayed inside the distance window for HOLD_MS (1 second) does the
  Arduino tell the PC app to take the picture. The PC app answers with the access decision, which
  is shown on a 16x2 I2C LCD with a beep pattern on the buzzer.

  Wiring
    HC-SR04  VCC -> 5V   GND -> GND   TRIG -> D9   ECHO -> D10
    LCD I2C  VCC -> 5V   GND -> GND   SDA  -> A4   SCL  -> A5   (Nano/Uno; Mega: SDA 20, SCL 21)
    Buzzer   +   -> D8   -   -> GND   (passive buzzer; for an active buzzer set PASSIVE_BUZZER false)

  Library: "LiquidCrystal I2C" by Frank de Brabander (Arduino IDE > Tools > Manage Libraries).
  If the screen stays blank, turn the blue contrast screw on the back, then try LCD_ADDRESS 0x3F.

  Serial protocol with the PC app (9600 baud, one message per line)
    Arduino -> PC   READY   student held the right distance for 1 s: take the picture now
                    AWAY    student left before a decision arrived: cancel
                    HELLO   sent once at start-up
    PC -> Arduino   G       access granted
                    D       access denied
                    A       already inside (let in earlier this exam session)
*/
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ------------------------------------------------------------------ settings
const uint8_t TRIG_PIN = 9;
const uint8_t ECHO_PIN = 10;
const uint8_t BUZZER_PIN = 8;
const bool PASSIVE_BUZZER = true;

const uint8_t LCD_ADDRESS = 0x27;

const int MIN_CM = 20;                 // closer than this: "step back"
const int MAX_CM = 40;                 // further than this: "come closer" (window centre 30 cm, as on the server)
const int GONE_CM = MAX_CM + 15;       // after a result, the student must step beyond this before the next scan
const unsigned long HOLD_MS = 1000;    // time in the window before the picture is taken
const unsigned long GRACE_MS = 200;    // one stray echo shorter than this does not restart the hold
const unsigned long ANSWER_MS = 6000;  // how long to wait for the PC's decision
const unsigned long RESULT_MS = 3000;  // how long a result stays on the screen
const unsigned long MEASURE_MS = 60;   // HC-SR04 needs ~60 ms between pings

LiquidCrystal_I2C lcd(LCD_ADDRESS, 16, 2);

enum State { WAITING, HOLDING, SCANNING, RESULT, LEAVING };
State state = WAITING;
unsigned long stateSince = 0;     // when the current state began
unsigned long lastInWindow = 0;   // last time a reading was inside the window
unsigned long lastMeasure = 0;
int distanceCm = -1;              // latest reading, -1 = nothing in range
String line1, line2;              // what is on the LCD now (rewritten only when it changes)
String incoming;

// ------------------------------------------------------------------ helpers
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
  if (top == line1 && bottom == line2) return;  // avoid flicker
  line1 = top; line2 = bottom;
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(top.substring(0, 16));
  lcd.setCursor(0, 1); lcd.print(bottom.substring(0, 16));
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

// Reads "G" / "D" / "A" lines from the PC. Returns 'G', 'D', 'A' or 0.
char readDecision() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      incoming.trim();
      char d = (incoming == "G" || incoming == "D" || incoming == "A") ? incoming[0] : 0;
      incoming = "";
      if (d) return d;
    } else if (incoming.length() < 16) {
      incoming += c;
    }
  }
  return 0;
}

// ------------------------------------------------------------------ main program
void setup() {
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  Serial.begin(9600);
  lcd.init();
  lcd.backlight();
  show("Smart Register", "Starting...");
  beep(1800, 60);
  delay(800);
  Serial.println("HELLO");
  enter(WAITING);
}

void loop() {
  unsigned long now = millis();
  char decision = readDecision();

  if (now - lastMeasure >= MEASURE_MS) {
    lastMeasure = now;
    distanceCm = measureMedianCm();
    if (inWindow(distanceCm)) lastInWindow = millis();
  }
  now = millis();
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
      if (decision) break;  // a late answer: keep showing the first one
      if (now - stateSince >= RESULT_MS) enter(LEAVING);
      break;

    case LEAVING:
      // the same student must step away before the next scan, so one person is not scanned twice
      if (distanceCm < 0 || distanceCm > GONE_CM) enter(WAITING);
      else show("Next student", "Step away first");
      break;
  }
}
