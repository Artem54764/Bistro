'use client';
import { useRef, useState } from 'react';
import { DEFAULT_CAT_ADDS, DEFAULT_DAY, MENU, SIDES, menuToText, norm, textToMenu, type CatAdds, type Day, type Menu } from '@/lib/order';
import { useLS } from '@/lib/hooks';

/** Вставлений текст -> список: по рядках; один рядок ділимо по ", " (щоб "Sok 0,33L" не розпався). */
const splitPaste = (t: string) =>
  (t.includes('\n') ? t.split(/\r?\n/) : t.split(/;|,\s+/)).map(s => s.trim()).filter(Boolean);
const addUniq = (xs: string[], add: string[]) =>
  add.reduce((acc, a) => (acc.some(x => norm(x) === norm(a)) ? acc : [...acc, a]), xs);

/** Фокус на поле вводу наступного списку (Enter у порожньому полі). */
function focusNext(from: HTMLElement) {
  const all = [...document.querySelectorAll<HTMLInputElement>('input.tnew')];
  all[all.indexOf(from as HTMLInputElement) + 1]?.focus();
}

/* ---------- список-«чипси»: Enter додає, Backspace повертає останній, клік — редагувати, перетягування ---------- */
function TagList({ value, onChange, placeholder, autoFocus }:
  { value: string[]; onChange: (v: string[]) => void; placeholder: string; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<number | null>(null);
  const drag = useRef<number | null>(null);

  const commit = (i: number, v: string) => {
    const t = v.trim();
    onChange(t ? value.map((x, k) => (k === i ? t : x)) : value.filter((_, k) => k !== i));
    setEdit(null);
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    const xs = [...value]; const [x] = xs.splice(from, 1); xs.splice(to, 0, x); onChange(xs);
  };

  return (
    <div className="tags">
      {value.map((x, i) => edit === i ? (
        <input key={i} className="tedit" autoFocus defaultValue={x} size={Math.max(4, x.length)}
          onBlur={e => commit(i, e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(i, e.currentTarget.value); }
            if (e.key === 'Escape') setEdit(null);
          }} />
      ) : (
        <span key={i} className="tag" draggable title="Kliknij — zmień, przeciągnij — kolejność"
          onDragStart={() => { drag.current = i; }} onDragOver={e => e.preventDefault()}
          onDrop={() => { if (drag.current != null) move(drag.current, i); drag.current = null; }}>
          <span onClick={() => setEdit(i)}>{x}</span>
          <button type="button" aria-label={'Usuń ' + x} onClick={() => onChange(value.filter((_, k) => k !== i))}>×</button>
        </span>
      ))}
      <input className="tnew" value={text} placeholder={placeholder} autoFocus={autoFocus}
        onChange={e => setText(e.target.value)}
        onPaste={e => {
          const parts = splitPaste(e.clipboardData.getData('text'));
          if (parts.length > 1) { e.preventDefault(); onChange(addUniq(value, parts)); }
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (text.trim()) { onChange(addUniq(value, [text.trim()])); setText(''); }
            else focusNext(e.currentTarget);
          } else if (e.key === 'Backspace' && !text && value.length) {
            e.preventDefault(); setText(value[value.length - 1]); onChange(value.slice(0, -1));
          }
        }} />
    </div>
  );
}

/* ---------- сторінка ---------- */
export default function MenuPage() {
  const [day, setDay] = useLS<Day>('day_v2', DEFAULT_DAY);
  const [menu, setMenu] = useLS<Menu>('menu_v2', MENU);
  const [catAdds, setCatAdds] = useLS<CatAdds>('catadds_v2', DEFAULT_CAT_ADDS);
  const [sides, setSides] = useLS<string[]>('sides_v2', SIDES);
  const [names, setNames] = useLS<string[]>('names_v1', []);
  const [asText, setAsText] = useState<string | null>(null);
  const [newCat, setNewCat] = useState('');

  const cats = Object.keys(menu);
  const setCat = (c: string, xs: string[]) => setMenu(m => ({ ...m, [c]: xs }));
  const rename = (from: string, to: string) => {
    to = to.trim();
    if (!to || to === from || cats.includes(to)) return;
    setMenu(m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k === from ? to : k, v])));
    setCatAdds(a => { const { [from]: x, ...rest } = a; return x ? { ...rest, [to]: x } : a; });
  };
  const moveCat = (c: string, d: number) => {
    const es = Object.entries(menu), i = cats.indexOf(c), j = i + d;
    if (j < 0 || j >= es.length) return;
    [es[i], es[j]] = [es[j], es[i]]; setMenu(Object.fromEntries(es));
  };
  const delCat = (c: string) => {
    if (menu[c].length && !confirm(`Usunąć kategorię „${c}” (${menu[c].length} pozycji)?`)) return;
    setMenu(m => Object.fromEntries(Object.entries(m).filter(([k]) => k !== c)));
    setCatAdds(a => { const { [c]: _, ...rest } = a; return rest; });
  };
  const addCat = () => {
    const c = newCat.trim(); if (!c || cats.includes(c)) return;
    setMenu(m => ({ ...m, [c]: [] })); setNewCat('');
    // одразу в поле страв нової категорії
    setTimeout(() => [...document.querySelectorAll<HTMLInputElement>('.cat input.tnew')].pop()?.focus(), 0);
  };

  return (
    <main className="menuPage">
      <section className="card">
        <div className="hd">
          <h2>Menu dnia</h2>
          <button type="button" onClick={() => confirm('Wyczyścić zupy i dania dnia?') && setDay({ ...day, soups: [], mains: [] })}>Nowe menu dnia</button>
        </div>
        <p className="hint">Wpisz nazwę → <kbd>Enter</kbd>. Pusty <kbd>Enter</kbd> — następna lista. <kbd>⌫</kbd> — popraw ostatnią. Można wkleić całą listę naraz.</p>
        <div className="dayGrid">
          <label>Zupy dnia<TagList autoFocus value={day.soups} onChange={v => setDay({ ...day, soups: v })} placeholder="rosół, krem…" /></label>
          <label>Dania dnia<TagList value={day.mains} onChange={v => setDay({ ...day, mains: v })} placeholder="kurczak…" /></label>
          <label>Opcje do zestawu<TagList value={day.opts} onChange={v => setDay({ ...day, opts: v })} placeholder="z frytkami, bez surówki…" /></label>
          <label>Dodatki do dań<TagList value={sides} onChange={setSides} placeholder="frytki, ryż…" /></label>
        </div>
      </section>

      <section className="card">
        <h2>Pracownicy</h2>
        <p className="hint">Imiona do podpowiedzi przy daniu (↑↓ + Enter). Nowe imiona z zamówień dopisują się same.</p>
        <TagList value={names} onChange={setNames} placeholder="Ania, Marek…" />
      </section>

      <section className="card">
        <div className="hd">
          <h2>Stałe menu <span className="mute">· {Object.values(menu).flat().length} pozycji</span></h2>
          <div className="lc" style={{ marginTop: 0 }}>
            {asText == null
              ? <button type="button" onClick={() => setAsText(menuToText(menu, catAdds))}>Edytuj jako tekst</button>
              : <>
                  <button type="button" className="primary" onClick={() => { const r = textToMenu(asText); setMenu(r.menu); setCatAdds(r.adds); setAsText(null); }}>Zapisz</button>
                  <button type="button" onClick={() => setAsText(null)}>Anuluj</button>
                </>}
            <button type="button" onClick={() => confirm('Przywrócić domyślne menu? Twoje zmiany zostaną utracone.') && (setMenu(MENU), setSides(SIDES), setCatAdds(DEFAULT_CAT_ADDS), setAsText(null))}>Domyślne</button>
          </div>
        </div>

        {asText != null ? (
          <>
            <p className="hint"><code># Nazwa kategorii</code>, pod nią każde danie w nowej linii, a dodatki kategorii z plusem: <code>+ jabłkowy</code>. Można wkleić całe menu.</p>
            <textarea className="bulk" autoFocus value={asText} onChange={e => setAsText(e.target.value)} spellCheck={false} />
          </>
        ) : (
          <>
            {cats.map((c, i) => (
              <div key={c} className="cat">
                <div className="catHd">
                  <input className="catName" defaultValue={c} key={c}
                    onBlur={e => { rename(c, e.target.value); e.target.value = c; }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                  <span className="mute">{menu[c].length}</span>
                  <button type="button" disabled={i === 0} onClick={() => moveCat(c, -1)} aria-label="W górę">↑</button>
                  <button type="button" disabled={i === cats.length - 1} onClick={() => moveCat(c, 1)} aria-label="W dół">↓</button>
                  <button type="button" onClick={() => delCat(c)} aria-label="Usuń kategorię">✕</button>
                </div>
                <TagList value={menu[c]} onChange={v => setCat(c, v)} placeholder="+ danie" />
                <div className="catAdds">
                  <span className="catAddsL">Dodatki tej kategorii</span>
                  <TagList value={catAdds[c] ?? []} placeholder="+ dodatek, np. smak: jabłkowy, pomarańczowy…"
                    onChange={v => setCatAdds(a => ({ ...a, [c]: v }))} />
                </div>
              </div>
            ))}
            <div className="catHd">
              <input className="catName" value={newCat} placeholder="+ Nowa kategoria, Enter"
                onChange={e => setNewCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCat(); }} />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
