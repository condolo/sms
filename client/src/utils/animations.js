export const EASE = [0.16, 1, 0.3, 1];

export const fadeUp = {
  hidden:  { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE } },
};

export const stagger = (d = 0.09) => ({
  hidden:  {},
  visible: { transition: { staggerChildren: d } },
});

export const VP = { once: true, amount: 0.15 };
