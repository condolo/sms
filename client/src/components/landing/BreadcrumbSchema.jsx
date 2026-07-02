/**
 * Injects a BreadcrumbList JSON-LD schema via react-helmet-async.
 * Usage: <BreadcrumbSchema items={[{ name: 'Pricing', href: '/pricing' }]} />
 * Always prepends Home automatically.
 */
import { Helmet } from 'react-helmet-async';

export default function BreadcrumbSchema({ items = [] }) {
  const BASE = 'https://msingi.io';
  const list = [
    { name: 'Home', href: '/' },
    ...items,
  ];

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: list.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${BASE}${item.href}`,
    })),
  };

  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(schema)}</script>
    </Helmet>
  );
}
