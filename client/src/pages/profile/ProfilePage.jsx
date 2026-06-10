import { useState, useRef, useEffect } from 'react';
import { Camera, Trash2, Save, Lock, User, CheckCircle, AlertCircle, Briefcase, Video, ExternalLink, Info } from 'lucide-react';
import useAuthStore from '@/store/auth.js';
import { auth as authApi, profile as profileApi } from '@/api/client.js';

/* ── client-side image resize using Canvas ────────────────────────────────── */
function resizeImageToBase64(file, maxPx = 256, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(maxPx / img.width, maxPx / img.height, 1);
        const w = Math.round(img.width  * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not decode image. Try a different file.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Inline status banner ──────────────────────────────────────────────────── */
function Banner({ type, message, onClose }) {
  if (!message) return null;
  const isOk = type === 'success';
  return (
    <div className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm ${isOk ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
      {isOk ? <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="text-xs opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

/* ── Section card wrapper ──────────────────────────────────────────────────── */
function Card({ title, icon: Icon, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

export default function ProfilePage() {
  const session    = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const user       = session?.user;

  /* ── photo state ─────────────────────────────────── */
  const [photoUrl,    setPhotoUrl]    = useState(user?.photoUrl || null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoBanner, setPhotoBanner] = useState({ type: '', msg: '' });
  const fileRef = useRef();

  /* ── profile state ───────────────────────────────── */
  const [name,    setName]    = useState(user?.name    || '');
  const [phone,   setPhone]   = useState(user?.phone   || '');
  const [bio,     setBio]     = useState(user?.bio     || '');
  const [profSaving, setProfSaving] = useState(false);
  const [profBanner, setProfBanner] = useState({ type: '', msg: '' });

  /* ── password state ──────────────────────────────── */
  const [currentPw,  setCurrentPw]  = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [confirmPw,  setConfirmPw]  = useState('');
  const [pwSaving,   setPwSaving]   = useState(false);
  const [pwBanner,   setPwBanner]   = useState({ type: '', msg: '' });
  const [showPws,    setShowPws]    = useState(false);

  /* ── staff record state ──────────────────────────── */
  // undefined = loading  |  null = no staff record  |  object = record found
  const [staffData,    setStaffData]    = useState(undefined);
  const [staffSaving,  setStaffSaving]  = useState(false);
  const [staffBanner,  setStaffBanner]  = useState({ type: '', msg: '' });
  const [sfAddress,    setSfAddress]    = useState('');
  const [sfDob,        setSfDob]        = useState('');
  const [sfQuals,      setSfQuals]      = useState('');
  const [sfSpec,       setSfSpec]       = useState('');
  const [sfNokName,    setSfNokName]    = useState('');
  const [sfNokPhone,   setSfNokPhone]   = useState('');
  const [sfNokRel,     setSfNokRel]     = useState('');

  /* ── meeting link state ──────────────────────────── */
  const [sfZoomLink,     setSfZoomLink]     = useState('');
  const [sfZoomPasscode, setSfZoomPasscode] = useState('');
  const [sfMeetLink,     setSfMeetLink]     = useState('');
  const [meetSaving,     setMeetSaving]     = useState(false);
  const [meetBanner,     setMeetBanner]     = useState({ type: '', msg: '' });

  /* fetch fresh photo url on mount if user has one */
  useEffect(() => {
    if (user?.id) {
      setPhotoUrl(`/api/users/${user.id}/photo?t=${Date.now()}`);
    }
  }, [user?.id]);

  /* fetch staff record on mount */
  useEffect(() => {
    profileApi.staffRecord()
      .then(json => {
        const rec = json?.data ?? null;
        setStaffData(rec);
        if (rec) {
          setSfAddress(rec.address       || '');
          setSfDob(rec.dateOfBirth ? rec.dateOfBirth.split('T')[0] : '');
          setSfQuals(rec.qualifications  || '');
          setSfSpec(rec.specialization   || '');
          setSfNokName(rec.nextOfKin?.name         || '');
          setSfNokPhone(rec.nextOfKin?.phone        || '');
          setSfNokRel(rec.nextOfKin?.relationship   || '');
          setSfZoomLink(rec.zoomPMILink  || '');
          setSfZoomPasscode(rec.zoomPasscode || '');
          setSfMeetLink(rec.meetLink     || '');
        }
      })
      .catch(() => setStaffData(null));
  }, []);

  const isStudent = user?.role === 'student' || user?.roles?.includes('student');

  /* ── photo upload ──────────────────────────────── */
  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setPhotoBanner({ type: 'error', msg: 'Unsupported format. Please use JPEG, PNG, or WebP.' });
      e.target.value = '';
      return;
    }

    // Warn if original file is very large — it will be resized but give feedback
    const originalSize = fmtBytes(file.size);
    if (file.size > 10 * 1024 * 1024) {
      setPhotoBanner({ type: 'error', msg: `File is ${originalSize}. Please use an image under 10 MB.` });
      e.target.value = '';
      return;
    }

    setPhotoLoading(true);
    setPhotoBanner({ type: '', msg: '' });

    try {
      const base64 = await resizeImageToBase64(file, 256, 0.82);
      await profileApi.uploadPhoto({ photoBase64: base64 });
      const freshUrl = `/api/users/${user.id}/photo?t=${Date.now()}`;
      setPhotoUrl(freshUrl);
      setSession({ ...session, user: { ...user, photoUrl: freshUrl } });
      setPhotoBanner({ type: 'success', msg: `Photo updated. (Original: ${originalSize} → resized to 256×256)` });
    } catch (err) {
      setPhotoBanner({ type: 'error', msg: err?.message || 'Upload failed. Please try again.' });
    } finally {
      setPhotoLoading(false);
      e.target.value = '';
    }
  }

  async function handleRemovePhoto() {
    if (!window.confirm('Remove your profile photo?')) return;
    setPhotoLoading(true);
    try {
      await profileApi.removePhoto();
      setPhotoUrl(null);
      setSession({ ...session, user: { ...user, photoUrl: null } });
      setPhotoBanner({ type: 'success', msg: 'Photo removed.' });
    } catch (err) {
      setPhotoBanner({ type: 'error', msg: err?.message || 'Failed to remove photo.' });
    } finally {
      setPhotoLoading(false);
    }
  }

  /* ── profile save ──────────────────────────────── */
  async function handleProfileSave(e) {
    e.preventDefault();
    if (!name.trim()) { setProfBanner({ type: 'error', msg: 'Name cannot be empty.' }); return; }
    setProfSaving(true);
    setProfBanner({ type: '', msg: '' });
    try {
      const token = JSON.parse(localStorage.getItem('msingi_session') || '{}')?.token;
      const { slug } = (await import('@/utils/schoolDetect.js')).detectSchool();
      const res = await fetch('/api/users/me', {
        method:  'PUT',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
          ...(slug ? { 'X-School-Slug': slug } : {}),
        },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), bio: bio.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      setSession({ ...session, user: { ...user, name: name.trim(), phone: phone.trim(), bio: bio.trim() } });
      setProfBanner({ type: 'success', msg: 'Profile updated successfully.' });
    } catch (err) {
      setProfBanner({ type: 'error', msg: err.message });
    } finally {
      setProfSaving(false);
    }
  }

  /* ── password change ───────────────────────────── */
  async function handlePasswordChange(e) {
    e.preventDefault();
    if (!currentPw) { setPwBanner({ type: 'error', msg: 'Current password is required.' }); return; }
    if (newPw.length < 8) { setPwBanner({ type: 'error', msg: 'New password must be at least 8 characters.' }); return; }
    if (newPw !== confirmPw) { setPwBanner({ type: 'error', msg: 'Passwords do not match.' }); return; }
    setPwSaving(true);
    setPwBanner({ type: '', msg: '' });
    try {
      await authApi.changePassword({ currentPassword: currentPw, newPassword: newPw });
      setPwBanner({ type: 'success', msg: 'Password changed successfully. Use your new password next time you sign in.' });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      setPwBanner({ type: 'error', msg: err.message || 'Failed to change password.' });
    } finally {
      setPwSaving(false);
    }
  }

  /* ── staff details save ───────────────────────────── */
  async function handleStaffSave(e) {
    e.preventDefault();
    setStaffSaving(true);
    setStaffBanner({ type: '', msg: '' });
    try {
      const json = await profileApi.updateStaffRecord({
        address:        sfAddress.trim(),
        dateOfBirth:    sfDob || null,
        qualifications: sfQuals.trim(),
        specialization: sfSpec.trim(),
        nextOfKin: {
          name:         sfNokName.trim(),
          phone:        sfNokPhone.trim(),
          relationship: sfNokRel.trim(),
        },
      });
      setStaffData(json?.data ?? staffData);
      setStaffBanner({ type: 'success', msg: 'Staff details updated.' });
    } catch (err) {
      setStaffBanner({ type: 'error', msg: err.message || 'Failed to update staff details.' });
    } finally {
      setStaffSaving(false);
    }
  }

  /* ── meeting links save ───────────────────────────── */
  async function handleMeetingSave(e) {
    e.preventDefault();
    // Basic URL validation — must be https:// or empty
    for (const [label, val] of [['Zoom link', sfZoomLink], ['Meet link', sfMeetLink]]) {
      if (val && !val.startsWith('https://')) {
        setMeetBanner({ type: 'error', msg: `${label} must start with https://` });
        return;
      }
    }
    setMeetSaving(true);
    setMeetBanner({ type: '', msg: '' });
    try {
      const json = await profileApi.updateStaffRecord({
        zoomPMILink:  sfZoomLink.trim(),
        zoomPasscode: sfZoomPasscode.trim(),
        meetLink:     sfMeetLink.trim(),
      });
      setStaffData(json?.data ?? staffData);
      setMeetBanner({ type: 'success', msg: 'Meeting links saved.' });
    } catch (err) {
      setMeetBanner({ type: 'error', msg: err.message || 'Failed to save meeting links.' });
    } finally {
      setMeetSaving(false);
    }
  }

  const initials = (user?.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = (user?.primaryRole || user?.role || 'user').replace(/_/g, ' ');

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">My Profile</h1>
        <p className="text-sm text-slate-500 mt-0.5">Update your personal information and account settings.</p>
      </div>

      {/* ── Photo card ─────────────────────────────────────────────── */}
      <Card title="Profile Photo" icon={Camera}>
        <div className="flex items-center gap-5">
          {/* Avatar */}
          <div className="relative shrink-0">
            <div className="h-20 w-20 rounded-full overflow-hidden bg-brand-600 flex items-center justify-center">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={user?.name}
                  className="h-full w-full object-cover"
                  onError={() => setPhotoUrl(null)}
                />
              ) : (
                <span className="text-white text-2xl font-bold">{initials}</span>
              )}
            </div>
            {photoLoading && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-800 truncate">{user?.name}</p>
            <p className="text-xs text-slate-500 capitalize mt-0.5">{roleLabel}</p>

            {isStudent ? (
              <p className="mt-3 text-xs text-slate-400">Student photos are managed through the student record in admissions.</p>
            ) : (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={photoLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  <Camera className="h-3 w-3" />
                  {photoUrl ? 'Change photo' : 'Upload photo'}
                </button>
                {photoUrl && (
                  <button
                    onClick={handleRemovePhoto}
                    disabled={photoLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {photoBanner.msg && (
          <div className="mt-4">
            <Banner type={photoBanner.type} message={photoBanner.msg} onClose={() => setPhotoBanner({ type: '', msg: '' })} />
          </div>
        )}
        <p className="text-xs text-slate-400 mt-3">
          JPEG, PNG or WebP · any size (auto-resized to 256×256 px) · max 10 MB original
        </p>
      </Card>

      {/* ── Personal info card ─────────────────────────────────────── */}
      <Card title="Personal Information" icon={User}>
        <form onSubmit={handleProfileSave} className="space-y-4">
          <Banner type={profBanner.type} message={profBanner.msg} onClose={() => setProfBanner({ type: '', msg: '' })} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Full name <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="form-input"
                placeholder="Your full name"
                required
              />
            </div>
            <div>
              <label className="form-label">Phone number</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="form-input"
                placeholder="+254 7XX XXX XXX"
              />
            </div>
          </div>

          <div>
            <label className="form-label">Email address</label>
            <input
              type="email"
              value={user?.email || ''}
              className="form-input bg-slate-50 cursor-not-allowed"
              readOnly
              disabled
            />
            <p className="text-xs text-slate-400 mt-1">Email address cannot be changed. Contact your administrator.</p>
          </div>

          <div>
            <label className="form-label">Short bio</label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              className="form-input resize-none"
              rows={3}
              placeholder="A short description about yourself (optional)"
              maxLength={300}
            />
            <p className="text-xs text-slate-400 mt-1">{bio.length}/300</p>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={profSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              <Save className="h-4 w-4" />
              {profSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </Card>

      {/* ── Password card ──────────────────────────────────────────── */}
      <Card title="Change Password" icon={Lock}>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <Banner type={pwBanner.type} message={pwBanner.msg} onClose={() => setPwBanner({ type: '', msg: '' })} />

          <div>
            <label className="form-label">Current password <span className="text-red-500">*</span></label>
            <input
              type={showPws ? 'text' : 'password'}
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              className="form-input"
              placeholder="Enter current password"
              autoComplete="current-password"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">New password <span className="text-red-500">*</span></label>
              <input
                type={showPws ? 'text' : 'password'}
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                className="form-input"
                placeholder="At least 8 characters"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div>
              <label className="form-label">Confirm new password <span className="text-red-500">*</span></label>
              <input
                type={showPws ? 'text' : 'password'}
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                className="form-input"
                placeholder="Repeat new password"
                autoComplete="new-password"
                required
              />
              {confirmPw && newPw !== confirmPw && (
                <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
              )}
              {confirmPw && newPw === confirmPw && confirmPw.length >= 8 && (
                <p className="text-xs text-green-600 mt-1">Passwords match</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showPws}
                onChange={e => setShowPws(e.target.checked)}
                className="rounded"
              />
              Show passwords
            </label>

            <button
              type="submit"
              disabled={pwSaving || !currentPw || newPw.length < 8 || newPw !== confirmPw}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              <Lock className="h-4 w-4" />
              {pwSaving ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
      </Card>

      {/* ── Staff Details card — only shown when a staff record exists ── */}
      {staffData && (
        <Card title="Staff Details" icon={Briefcase}>
          <form onSubmit={handleStaffSave} className="space-y-5">
            <Banner type={staffBanner.type} message={staffBanner.msg} onClose={() => setStaffBanner({ type: '', msg: '' })} />

            {/* Address + DOB */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Home address</label>
                <textarea
                  value={sfAddress}
                  onChange={e => setSfAddress(e.target.value)}
                  className="form-input resize-none"
                  rows={2}
                  placeholder="Street, city, county"
                  maxLength={500}
                />
              </div>
              <div>
                <label className="form-label">Date of birth</label>
                <input
                  type="date"
                  value={sfDob}
                  onChange={e => setSfDob(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            {/* Qualifications + Specialization */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Qualifications</label>
                <input
                  type="text"
                  value={sfQuals}
                  onChange={e => setSfQuals(e.target.value)}
                  className="form-input"
                  placeholder="e.g. BEd Science, PGCE"
                  maxLength={500}
                />
              </div>
              <div>
                <label className="form-label">Specialization</label>
                <input
                  type="text"
                  value={sfSpec}
                  onChange={e => setSfSpec(e.target.value)}
                  className="form-input"
                  placeholder="e.g. Mathematics, Biology"
                  maxLength={200}
                />
              </div>
            </div>

            {/* Next of Kin */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Emergency Contact (Next of Kin)</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="form-label">Full name</label>
                  <input
                    type="text"
                    value={sfNokName}
                    onChange={e => setSfNokName(e.target.value)}
                    className="form-input"
                    placeholder="Contact name"
                    maxLength={100}
                  />
                </div>
                <div>
                  <label className="form-label">Phone</label>
                  <input
                    type="tel"
                    value={sfNokPhone}
                    onChange={e => setSfNokPhone(e.target.value)}
                    className="form-input"
                    placeholder="+254 7XX XXX XXX"
                    maxLength={30}
                  />
                </div>
                <div>
                  <label className="form-label">Relationship</label>
                  <input
                    type="text"
                    value={sfNokRel}
                    onChange={e => setSfNokRel(e.target.value)}
                    className="form-input"
                    placeholder="e.g. Spouse, Parent"
                    maxLength={50}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">HR-managed fields (department, contract, employment status) can only be updated by your HR team.</p>
              <button
                type="submit"
                disabled={staffSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors shrink-0 ml-4"
              >
                <Save className="h-4 w-4" />
                {staffSaving ? 'Saving…' : 'Save details'}
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* ── Meeting Links card — staff only ────────────────────────── */}
      {staffData && (
        <Card title="Online Meeting Links" icon={Video}>
          <form onSubmit={handleMeetingSave} className="space-y-5">
            <Banner type={meetBanner.type} message={meetBanner.msg} onClose={() => setMeetBanner({ type: '', msg: '' })} />

            {/* Info banner */}
            <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3.5 py-3 text-xs text-blue-700">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-400" />
              <span>Save your personal meeting links here once. They are used when you schedule online classes — no sign-in or API keys required. Students and parents receive the link automatically when you schedule a session.</span>
            </div>

            {/* Zoom PMI */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Zoom (Personal Meeting Room)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Zoom PMI Link</label>
                  <div className="relative">
                    <input
                      type="url"
                      value={sfZoomLink}
                      onChange={e => setSfZoomLink(e.target.value)}
                      className="form-input pr-8"
                      placeholder="https://zoom.us/j/123456789"
                    />
                    {sfZoomLink && (
                      <a href={sfZoomLink} target="_blank" rel="noopener noreferrer"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-500 transition">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Your permanent Zoom meeting room — find it in the Zoom app under "Personal Meeting Room"</p>
                </div>
                <div>
                  <label className="form-label">Passcode <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input
                    type="text"
                    value={sfZoomPasscode}
                    onChange={e => setSfZoomPasscode(e.target.value)}
                    className="form-input"
                    placeholder="e.g. abc123"
                    maxLength={20}
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Shown to students so they can join your room directly</p>
                </div>
              </div>
            </div>

            {/* Google Meet */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Google Meet (Personal Room)</p>
              <div>
                <label className="form-label">Meet Link</label>
                <div className="relative">
                  <input
                    type="url"
                    value={sfMeetLink}
                    onChange={e => setSfMeetLink(e.target.value)}
                    className="form-input pr-8"
                    placeholder="https://meet.google.com/abc-defg-hij"
                  />
                  {sfMeetLink && (
                    <a href={sfMeetLink} target="_blank" rel="noopener noreferrer"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-500 transition">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Create a personal Meet room at <a href="https://meet.google.com" target="_blank" rel="noopener noreferrer" className="underline">meet.google.com</a> → use the reusable room link</p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={meetSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                <Save className="h-4 w-4" />
                {meetSaving ? 'Saving…' : 'Save meeting links'}
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* ── Account info (read-only) ───────────────────────────────── */}
      <div className="rounded-xl bg-slate-50 border border-slate-200 px-5 py-4 text-xs text-slate-500 space-y-1">
        <p><span className="font-medium text-slate-700">Role:</span> <span className="capitalize">{roleLabel}</span></p>
        {user?.staffId && <p><span className="font-medium text-slate-700">Staff ID:</span> {user.staffId}</p>}
        <p><span className="font-medium text-slate-700">Member since:</span> {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</p>
        <p><span className="font-medium text-slate-700">Last sign-in:</span> {user?.lastLogin ? new Date(user.lastLogin).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</p>
      </div>
    </div>
  );
}
