'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Header() {
  const path = usePathname();
  return (
    <header className="top">
      <div className="topIn">
        <Link href="/" className="brand" aria-label="Trzcina Bistro">
          <span className="logo">T</span>
          <span className="bname">Trzcina<small>bistro</small></span>
        </Link>
        <nav className="tabs">
          <Link href="/" className={path === '/' ? 'on' : ''}>Nowe zamówienie</Link>
          <Link href="/tracker" className={path === '/tracker' ? 'on' : ''}>Tracker</Link>
          <Link href="/mapa" className={path === '/mapa' ? 'on' : ''}>Mapa</Link>
          <Link href="/menu" className={path === '/menu' ? 'on' : ''}>Menu</Link>
        </nav>
      </div>
    </header>
  );
}
