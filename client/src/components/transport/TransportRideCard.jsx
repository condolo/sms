/* ============================================================
   TransportRideCard — the bus this student rides.

   ONE card, two faces: the parent portal renders it for a child, the student
   portal for the account's own record. Both read the same join
   (server/utils/transport-ride.js), so both must draw it the same way — the
   card owns the rendering rather than each dashboard copying it.

   Two things it deliberately does not pretend, matching the endpoint's own
   note: it cannot locate the bus (nothing tracks a vehicle in time), and a
   deleted route (`route: null`) hides the vehicle and times instead of
   showing them blank, while the route's NAME survives on the assignment.
   ============================================================ */
import { Bus, Loader2, MapPin, Phone, User } from 'lucide-react';

function StatusPill({ status }) {
  const ended = status === 'inactive';
  return (
    <span className={`shrink-0 px-2 py-[3px] rounded-full text-[10px] font-bold uppercase tracking-wide ${
      ended ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'
    }`}>
      {ended ? 'Ended' : 'Active'}
    </span>
  );
}

export default function TransportRideCard({
  id,
  assignments = [],
  loading = false,
  error = '',
  emptyMessage = 'No school transport is on file.',
  title = 'School Transport',
}) {
  /* A current run first; an ended one is still worth showing (a family asks
     "what did we have last term"), but never above the run they are on now. */
  const active = assignments.filter(a => a.status !== 'inactive');
  const list = active.length ? active : assignments;

  return (
    <div id={id} className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center gap-2">
        <Bus size={14} className="flex-shrink-0 text-amber-500" />
        <h2 className="text-[13px] font-bold text-slate-900">{title}</h2>
      </div>

      {loading ? (
        <div className="px-[18px] py-10 flex items-center justify-center gap-2 text-[12px] text-slate-400">
          <Loader2 size={14} className="animate-spin" /> Loading transport details…
        </div>
      ) : error ? (
        <p className="px-[18px] py-8 text-[12px] text-red-600 text-center">{error}</p>
      ) : list.length === 0 ? (
        <div className="px-[18px] py-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-300 flex items-center justify-center mx-auto">
            <Bus size={22} />
          </div>
          <p className="text-[13px] font-semibold text-slate-700 mt-3">No transport assigned</p>
          <p className="text-[12px] text-slate-400 mt-1 max-w-[280px] mx-auto leading-relaxed">{emptyMessage}</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {list.map(a => {
            const route = a.route;
            const fare  = (route?.fares ?? []).find(f => f.fareType === a.fareType);
            return (
              <div key={a.id} className="px-[18px] py-4 space-y-3">
                {/* Route + state */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-slate-900 truncate">{a.routeName || 'Route'}</p>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1">
                      {route?.origin && route?.destination ? (
                        <><MapPin size={10} /> {route.origin} → {route.destination}</>
                      ) : 'School run'}
                    </p>
                  </div>
                  <StatusPill status={a.status} />
                </div>

                {!route && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    This route is no longer on the school's list, so the vehicle and times are not
                    shown. Ask the office if the run still happens.
                  </p>
                )}

                {route && (
                  <>
                    {/* Vehicle + driver — the driver's number is the point of the card */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                          <Bus size={15} />
                        </span>
                        <div>
                          <p className="text-[12px] font-semibold text-slate-800 capitalize">
                            {route.vehicleType || 'Vehicle'}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono">{route.vehicleReg || '—'}</p>
                        </div>
                      </div>
                      {route.driverName && (
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                            <User size={15} />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-slate-800 truncate">{route.driverName}</p>
                            {route.driverPhone ? (
                              <a href={`tel:${String(route.driverPhone).replace(/[^\d+]/g, '')}`}
                                className="text-[11px] text-sky-600 hover:text-sky-800 inline-flex items-center gap-1">
                                <Phone size={10} /> {route.driverPhone}
                              </a>
                            ) : <p className="text-[11px] text-slate-400">No number on file</p>}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Stop, direction, times */}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pickup stop</p>
                        <p className="text-slate-800 font-medium">{a.pickupStop || 'Not set'}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Travels</p>
                        <p className="text-slate-800 font-medium capitalize">
                          {a.direction === 'to_school' ? 'To school only'
                            : a.direction === 'from_school' ? 'From school only'
                              : 'Both ways'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Departs</p>
                        <p className="text-slate-800 font-medium">{route.departureTime || '—'}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Arrives</p>
                        <p className="text-slate-800 font-medium">{route.arrivalTime || '—'}</p>
                      </div>
                    </div>

                    {(route.stops ?? []).length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Stops on this run</p>
                        <div className="flex flex-wrap gap-1">
                          {route.stops.map(stop => (
                            <span key={stop}
                              className={`rounded-full border px-2 py-[3px] text-[10px] ${
                                stop === a.pickupStop
                                  ? 'border-amber-300 bg-amber-50 text-amber-700 font-semibold'
                                  : 'border-slate-200 bg-white text-slate-500'
                              }`}>
                              {stop}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* What this run costs, and when it runs */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  <span>
                    {a.fareType === 'one_way' ? 'One-way fare' : a.fareType === 'two_way' ? 'Two-way fare' : 'Fare'}:
                    {' '}
                    <strong className="text-slate-800">
                      {fare ? `KSh ${Number(fare.amount).toLocaleString()} per term` : 'ask the office'}
                    </strong>
                  </span>
                  {a.startDate && <span>From {a.startDate}</span>}
                  {a.endDate && <span>To {a.endDate}</span>}
                </div>
                {a.notes && <p className="text-[11px] text-slate-400 italic">{a.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
