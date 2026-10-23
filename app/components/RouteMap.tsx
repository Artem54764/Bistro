'use client';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef, type ReactNode } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';

/** name — підпис біля точки (вулиця й номер), у кольорі точки. */
export type Pin = { id: number; n: number; lat: number; lon: number; color: string; label: string; text: string; done?: boolean; name?: string };
/** dash — пунктир (траса водія, який уже в дорозі). */
export type Line = { color: string; points: [number, number][]; dash?: boolean };
/** Куди перелетіти: точка + (необов'язково) пін, чиє вікно відкрити; t — щоб повторний клік теж спрацював. */
export type Focus = { lat: number; lon: number; zoom: number; id?: number; t: number };

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const pinIcon = (p: Pin) => L.divIcon({
  className: '',
  html: `<div class="pin${p.done ? ' done' : ''}" style="--c:${p.color}"><b>${p.label}</b>${p.name ? `<span class="pinName">${esc(p.name)}</span>` : ''}</div>`,
  iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14],
});
const depotIcon = L.divIcon({ className: '', html: '<div class="pin depot">T</div>', iconSize: [36, 36], iconAnchor: [18, 18] });
const pickIcon = L.divIcon({ className: '', html: '<div class="pin pick">+</div>', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });

/** Підганяє масштаб під усі точки, коли їх набір змінюється. */
function Fit({ pts }: { pts: [number, number][] }) {
  const map = useMap();
  const key = pts.map(p => p.join(',')).join(';');
  useEffect(() => {
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
    else if (pts.length === 1) map.setView(pts[0], 14);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
function FlyTo({ f, markers }: { f: Focus | null; markers: React.RefObject<Map<number, L.Marker>> }) {
  const map = useMap();
  useEffect(() => {
    if (!f) return;
    map.flyTo([f.lat, f.lon], f.zoom, { duration: 0.6 });
    if (f.id != null) { const id = f.id; setTimeout(() => markers.current?.get(id)?.openPopup(), 650); }
  }, [f?.t]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
/** Показати певні точки (напр. трасу вибраного водія); t — щоб спрацювало й повторно. */
function FitTo({ fit }: { fit: { pts: [number, number][]; t: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (fit && fit.pts.length) map.fitBounds(L.latLngBounds(fit.pts), { padding: [60, 60], maxZoom: 16 });
  }, [fit?.t]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
function ClickToPick({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}
/** Точка, яку клацнули на карті: маркер з одразу відкритим вікном дій. */
function Picked({ at, children }: { at: [number, number]; children: ReactNode }) {
  const ref = useRef<L.Marker>(null);
  useEffect(() => { ref.current?.openPopup(); }, [at[0], at[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Marker ref={ref} position={at} icon={pickIcon}><Popup minWidth={240}>{children}</Popup></Marker>;
}

export default function RouteMap({ pins, lines, depot, picked, pickedContent, onPick, focus, fit = null }: {
  pins: Pin[]; lines: Line[]; depot: [number, number];
  picked: [number, number] | null; pickedContent: ReactNode; onPick: (lat: number, lon: number) => void;
  focus: Focus | null; fit?: { pts: [number, number][]; t: number } | null;
}) {
  const markers = useRef(new Map<number, L.Marker>());
  const all: [number, number][] = [...pins.map(p => [p.lat, p.lon] as [number, number]), depot];
  return (
    <MapContainer center={depot} zoom={13} className="mapBox picking" scrollWheelZoom>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Fit pts={all} />
      <ClickToPick onPick={onPick} />
      <FlyTo f={focus} markers={markers} />
      <FitTo fit={fit} />
      {lines.map((l, i) => <Polyline key={i} positions={l.points}
        pathOptions={l.dash ? { color: l.color, weight: 5, opacity: .9, dashArray: '10 8' } : { color: l.color, weight: 5, opacity: .85 }} />)}
      <Marker position={depot} icon={depotIcon}><Popup>Trzcina Bistro — start i powrót</Popup></Marker>
      {picked && <Picked at={picked}>{pickedContent}</Picked>}
      {pins.map(p => (
        <Marker key={p.id} position={[p.lat, p.lon]} icon={pinIcon(p)}
          ref={m => { if (m) markers.current.set(p.id, m); else markers.current.delete(p.id); }}>
          <Popup><pre className="popTxt">{p.text}</pre></Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
