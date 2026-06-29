export default function GradientHeroBG() {
  return (
    <>
      <div className="absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full bg-indigo-100/70 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[360px] h-[360px] rounded-full bg-sky-100/50 blur-3xl pointer-events-none" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          opacity: 0.4,
        }}
      />
    </>
  );
}
