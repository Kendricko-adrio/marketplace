import './prototype.css';

export const metadata = {
  title: 'Delivery · Compact Operations Prototype',
  description: 'Disposable mock-only UI exploration. No real orders or provider requests.',
  robots: { index: false, follow: false },
};

export default function PrototypeLayout({ children }) {
  return <html lang="id"><body>{children}</body></html>;
}
