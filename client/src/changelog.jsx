import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * "Qué cambió": muestra el changelog de una versión y resalta las frases que suelen avisar de
 * problemas (cambios incompatibles, requisitos nuevos, configuración que se reinicia).
 */
const RISKY = /\b(breaking|incompatib|requires?|required|minimum|dropped|removed?|no longer|migrat|reset|deprecat|must|rompe|incompatible|requiere|mínim|elimina|ya no)\b/i;

export function riskyLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s*#>-]+/, '').trim())
    .filter((l) => l && RISKY.test(l))
    .slice(0, 5);
}

export default function Changelog({ text, lines, compact = false }) {
  const body = text || (lines || []).map((l) => `- ${l}`).join('\n');
  if (!body.trim()) return <p className="faint small">Esta versión no trae notas de cambios.</p>;
  const risky = riskyLines(body);
  const html = DOMPurify.sanitize(marked.parse(body), { FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'img'], FORBID_ATTR: ['style'] });
  return (
    <div className="changelog stack" style={{ gap: '0.5rem' }}>
      {risky.length > 0 && (
        <div className="note small">
          <strong>Ojo, puede afectar a tu servidor:</strong>
          <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem' }}>
            {risky.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={`doc small${compact ? ' changelog-compact' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
