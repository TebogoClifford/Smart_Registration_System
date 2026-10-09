import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { UserPlus, CheckCircle2, Info, AlertCircle, Loader2, ArrowRight, XCircle, RefreshCcw } from 'lucide-react';

function TableSkeleton() {
  return (
    <div className="space-y-3 w-full">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 bg-muted/50 animate-pulse rounded-lg">
          <div className="h-4 w-32 bg-muted-foreground/20 rounded" />
          <div className="h-4 w-24 bg-muted-foreground/20 rounded" />
          <div className="h-4 w-16 bg-muted-foreground/20 rounded ml-auto" />
        </div>
      ))}
    </div>
  );
}

export default function Enroll() {
  const [step, setStep] = useState(1); // 1: Form, 2: Progress
  const [captureState, setCaptureState] = useState('capturing'); // capturing, enrolled, failed
  const [loading, setLoading] = useState(false);

  // Form State
  const [studentNumber, setStudentNumber] = useState('');
  const [name, setName] = useState('');
  const [venueId, setVenueId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [consent, setConsent] = useState(false);

  // Data State
  const [venues, setVenues] = useState([]);
  const [devices, setDevices] = useState([]);
  const [filteredDevices, setFilteredDevices] = useState([]);
  const [recentEnrollments, setRecentEnrollments] = useState([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);

  const [errors, setErrors] = useState({});
  const navigate = useNavigate();

  const loadInitialData = useCallback(async () => {
    try {
      const [venueData, deviceData] = await Promise.all([api.getVenues(), api.getDevices()]);
      setVenues(Array.isArray(venueData) ? venueData : []);
      setDevices(Array.isArray(deviceData) ? deviceData : []);
    } catch (err) {
      console.error('Failed to load enrollment configuration:', err);
      toast.error('Could not load venues and devices. Refresh the page to try again.');
    }
  }, []);

  const loadRecentEnrollments = useCallback(async ({ showLoader = false } = {}) => {
    if (showLoader) setIsLoadingRecent(true);
    try {
      const data = await api.getStudents();
      const students = Array.isArray(data) ? data : [];
      const sorted = [...students].sort((a, b) => {
        const aId = Number(a.id);
        const bId = Number(b.id);
        if (Number.isFinite(aId) && Number.isFinite(bId)) return bId - aId;
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
      setRecentEnrollments(sorted.slice(0, 5));
    } catch (err) {
      console.error('Failed to load recent enrollments:', err);
      toast.error('Could not refresh the recent enrolments list.');
    } finally {
      if (showLoader) setIsLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
    loadRecentEnrollments({ showLoader: true });
    // Refresh the persisted list so recently added students do not disappear
    // when the backend has just finished processing a request.
    const refreshTimer = window.setInterval(() => loadRecentEnrollments(), 15000);
    return () => window.clearInterval(refreshTimer);
  }, [loadInitialData, loadRecentEnrollments]);

  const filteredDevices = useMemo(
    () => devices.filter((device) => String(device.venue_id) === String(venueId)),
    [devices, venueId]
  );

  const validate = () => {
    const newErrors = {};
    if (!studentNumber.trim()) newErrors.studentNumber = 'Student number is required';
    if (!name.trim()) newErrors.name = 'Full name is required';
    if (!venueId) newErrors.venueId = 'Please select a venue';
    if (!deviceId) newErrors.deviceId = 'Please select a device';
    if (!consent) newErrors.consent = 'Consent is required to proceed';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleStartEnrollment = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await api.createStudent(studentNumber.trim(), name.trim(), Number(deviceId));
      // Reload from the API after saving so the recent list reflects persisted data.
      await loadRecentEnrollments();
      toast.success('Student record saved. The device can now begin capture.');
      setStep(2);
      setCaptureState('capturing');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setStudentNumber('');
    setName('');
    setVenueId('');
    setDeviceId('');
    setConsent(false);
    setErrors({});
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight">Student enrollment</h2>
          <p className="text-muted-foreground">Capture a student's face on a venue device.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-10 gap-8">
        {/* Left Column: Form/Progress (60%) */}
        <div className="lg:col-span-6 space-y-6">
          {step === 1 ? (
            <Card className="border-none shadow-sm">
              <CardHeader className="flex flex-row items-center gap-3 pb-4">
                <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] uppercase tracking-wider">
                  Step 1 of 2
                </Badge>
                <CardTitle className="text-lg font-semibold">Student details</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleStartEnrollment} className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Student Number</label>
                    <Input
                      autoFocus
                      value={studentNumber}
                      onChange={(e) => setStudentNumber(e.target.value)}
                      placeholder="e.g. 21001234"
                      className={errors.studentNumber ? 'border-red-500' : ''}
                    />
                    <p className="text-xs text-muted-foreground">As printed on the student card.</p>
                    {errors.studentNumber && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle size={12} /> {errors.studentNumber}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Full Name</label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter full name"
                      className={errors.name ? 'border-red-500' : ''}
                    />
                    {errors.name && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle size={12} /> {errors.name}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Venue</label>
                      <Select value={venueId} onValueChange={(value) => { setVenueId(value); setDeviceId(''); setErrors((current) => ({ ...current, venueId: '', deviceId: '' })); }}>
                        <SelectTrigger className={errors.venueId ? 'border-red-500' : ''}>
                          <SelectValue placeholder="Select Venue" />
                        </SelectTrigger>
                        <SelectContent>
                          {venues.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {errors.venueId && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <AlertCircle size={12} /> {errors.venueId}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Device</label>
                      <Select value={deviceId} onValueChange={setDeviceId}>
                        <SelectTrigger className={errors.deviceId ? 'border-red-500' : ''}>
                          <SelectValue placeholder="Select Device" />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredDevices.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {errors.deviceId && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <AlertCircle size={12} /> {errors.deviceId}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="p-3 bg-primary/5 border border-primary/10 rounded-lg space-y-3">
                    <div className="flex items-start gap-3">
                      <Input
                        type="checkbox"
                        id="consent"
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <label htmlFor="consent" className="text-sm text-muted-foreground leading-relaxed">
                        The student has been told why their face is captured and agrees to it.
                      </label>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground ml-7">
                      <span className="font-medium">Confirmed by:</span>
                      <span className="text-foreground">Teboho M. (Invigilator)</span>
                    </div>
                    {errors.consent && (
                      <p className="text-xs text-red-500 flex items-center gap-1 ml-7">
                        <AlertCircle size={12} /> {errors.consent}
                      </p>
                    )}
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <><Loader2 size={16} className="mr-2 animate-spin" /> Starting...</>
                    ) : (
                      'Start enrollment'
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-none shadow-sm" aria-live="polite">
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <div className="space-y-1">
                  <CardTitle className="text-lg font-semibold">Enrolling {name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Student: {studentNumber} · Device: {devices.find(d => String(d.id) === deviceId)?.name}
                  </p>
                </div>
                <Badge className={`flex items-center gap-1 ${
                  captureState === 'capturing' ? 'bg-blue-100 text-blue-700 border-blue-200 animate-pulse' :
                  captureState === 'enrolled' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'
                }`}>
                  {captureState === 'capturing' && <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
                  {captureState === 'enrolled' && <span className="w-1.5 h-1.5 rounded-full bg-green-600" />}
                  {captureState === 'failed' && <span className="w-1.5 h-1.5 rounded-full bg-red-600" />}
                  {captureState === 'capturing' ? 'Capturing...' : captureState === 'enrolled' ? 'Enrolled' : 'Failed'}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-8">
                {captureState === 'capturing' && (
                  <>
                    <div className="flex items-center justify-between relative">
                      <div className="absolute top-1/2 left-0 w-full h-0.5 bg-muted -translate-y-1/2 z-0" />
                      {[
                        { label: 'Details saved', status: 'done' },
                        { label: 'Device ready', status: 'done' },
                        { label: 'Capturing', status: 'active' },
                        { label: 'Enrolled', status: 'future' },
                      ].map((step, i) => (
                        <div key={i} className="relative z-10 flex flex-col items-center gap-2">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                            step.status === 'done' ? 'bg-green-500 text-white' :
                            step.status === 'active' ? 'bg-primary text-white ring-4 ring-primary/20' : 'bg-muted text-muted-foreground'
                          }`}>
                            {step.status === 'done' ? <CheckCircle2 size={14} /> : i + 1}
                          </div>
                          <span className={`text-[10px] font-medium ${step.status === 'active' ? 'text-primary' : 'text-muted-foreground'}`}>
                            {step.label}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-3 text-blue-700">
                      <Info size={20} className="shrink-0" />
                      <p className="text-sm font-medium">Ask the student to face the camera and stay still.</p>
                    </div>
                    <div className="flex justify-center">
                      <Button variant="outline" onClick={() => setStep(1)}>Cancel capture</Button>
                    </div>
                  </>
                )}

                {captureState === 'enrolled' && (
                  <div className="py-10 text-center space-y-6">
                    <div className="mx-auto w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                      <CheckCircle2 size={32} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl font-bold">Enrollment Successful!</h3>
                      <p className="text-muted-foreground text-sm">The student's face has been captured and stored on the device.</p>
                    </div>
                    <Button onClick={handleReset} className="gap-2">
                      <UserPlus size={16} /> Enroll another student
                    </Button>
                  </div>
                )}

                {captureState === 'failed' && (
                  <div className="py-10 text-center space-y-6">
                    <div className="mx-auto w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                      <XCircle size={32} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl font-bold">Capture Failed</h3>
                      <p className="text-muted-foreground text-sm">The device could not capture a clear image. Please try again.</p>
                    </div>
                    <div className="flex items-center justify-center gap-3">
                      <Button variant="outline" onClick={() => setCaptureState('capturing')} className="gap-2">
                        <RefreshCcw size={16} /> Try again
                      </Button>
                      <Button variant="ghost" onClick={() => { setStep(1); handleReset(); }} className="gap-2">
                        Edit details
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Info Panel (40%) */}
        <div className="lg:col-span-4">
          <Card className="border-none shadow-sm bg-muted/30">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Before you start</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                'Student stands inside the capture distance window',
                'Even lighting, no strong light behind them',
                'Face the camera, remove glasses or a cap if possible',
                'Device must show Online before you start',
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <div className="mt-1 w-4 h-4 rounded-full border border-muted-foreground/30 flex items-center justify-center shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                  </div>
                  <p>{item}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Enrollments */}
      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Recent enrollments</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingRecent ? (
            <TableSkeleton />
          ) : recentEnrollments.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                <UserPlus size={24} />
              </div>
              <p className="text-muted-foreground text-sm">Enrolled students appear here</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="uppercase tracking-wider text-[12px] font-semibold">Student</TableHead>
                  <TableHead className="uppercase tracking-wider text-[12px] font-semibold">Device</TableHead>
                  <TableHead className="uppercase tracking-wider text-[12px] font-semibold">Status</TableHead>
                  <TableHead className="uppercase tracking-wider text-[12px] font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentEnrollments.map((s) => (
                  <TableRow key={s.id} className="h-[56px]">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{s.student_number}</span>
                      </div>
                    </TableCell>
                    <TableCell>{s.device_id}</TableCell>
                    <TableCell>
                      <Badge variant={s.enrollment_status === 'enrolled' ? 'default' : 'secondary'} className="flex items-center gap-1 w-fit">
                        <span className={`w-1.5 h-1.5 rounded-full ${s.enrollment_status === 'enrolled' ? 'bg-green-600' : 'bg-amber-600'}`} />
                        {s.enrollment_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" className="h-7 text-xs">Re-enroll</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}