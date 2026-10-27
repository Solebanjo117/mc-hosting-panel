import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { usePageTitle } from '../ui.jsx';

// Mismo formato de anclas que GitHub, para que funcionen los enlaces del índice del manual.
const slug = (text) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

const DOCS = [
  { id: 'puertos', label: 'Abrir puertos en casa', title: 'Guía para abrir puertos' },
  { id: 'linux', label: 'Linux y la nube', title: 'Linux y la nube' },
];

export default function Guide() {
  const { doc: docParam } = useParams();
  const current = DOCS.find((d) => d.id === docParam) || DOCS[0];
  const [md, setMd] = useState('');
  const [error, setError] = useState('');
  usePageTitle(current.title);

  useEffect(() => {
    setMd('');
    setError('');
    api(`/system/docs/${current.id}`)
      .then(setMd)
      .catch((err) => setError(err.message));
  }, [current.id]);

  const { html, toc } = useMemo(() => {
    if (!md) return { html: '', toc: [] };
    const doc = new DOMParser().parseFromString(marked.parse(md), 'text/html');
    const toc = [];
    for (const h of doc.querySelectorAll('h1, h2, h3')) {
      h.id = slug(h.textContent);
      if (h.tagName === 'H2' && !/^índice$/i.test(h.textContent.trim())) toc.push({ id: h.id, text: h.textContent });
    }
    // Accesibilidad: los bloques de código se pueden recorrer con el teclado y las casillas son solo texto.
    for (const pre of doc.querySelectorAll('pre')) pre.tabIndex = 0;
    for (const box of doc.querySelectorAll('input[type="checkbox"]')) box.replaceWith(doc.createTextNode(box.checked ? '☑ ' : '☐ '));
    for (const a of doc.querySelectorAll('a[href^="http"]')) {
      a.target = '_blank';
      a.rel = 'noreferrer';
    }
    return { html: doc.body.innerHTML, toc };
  }, [md]);

  useEffect(() => {
    if (html && location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }, [html]);

  return (
    <div className="page">
      <nav className="subtabs" aria-label="Guías">
        {DOCS.map((d) => (
          <Link key={d.id} to={d.id === 'puertos' ? '/guia' : `/guia/${d.id}`} className={`subtab${d.id === current.id ? ' active' : ''}`} aria-current={d.id === current.id ? 'page' : undefined}>
            {d.label}
          </Link>
        ))}
      </nav>
      {error && <div className="error-box">No se pudo cargar la guía: {error}</div>}
      <div className="doc-layout">
        <article className="doc" dangerouslySetInnerHTML={{ __html: html }} />
        <nav className="doc-toc" aria-label="Contenido de la guía">
          {toc.map((t) => (
            <a key={t.id} href={`#${t.id}`}>
              {t.text}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
