/* Partner-school trust bar — continuous right-to-left logo scroll.
   The track renders the logo list twice back to back; the CSS animation
   (index.css, .logo-marquee-track) moves it exactly -50% of its own
   width, so the second copy lands where the first started and the loop
   reads as endless. Pauses on hover and respects prefers-reduced-motion. */
export default function LogoMarquee({ schools }) {
  const track = [...schools, ...schools];

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
      }}
    >
      <div className="logo-marquee-track flex items-center gap-14 w-max">
        {track.map((school, i) => (
          <div key={`${school.name}-${i}`} className="flex items-center gap-2.5 flex-shrink-0" title={school.name}>
            <img
              src={school.logo}
              alt={`${school.name} logo`}
              className="h-11 w-11 object-contain flex-shrink-0 rounded-md"
              loading="lazy"
            />
            <span className="text-sm font-semibold text-slate-600 whitespace-nowrap">{school.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
