import { useCallback, useEffect, useRef, useState } from 'react';
import { api, qs, formatBytes, formatDate, uploadWithProgress } from '../../api.js';
import { Confirm, Modal, Progress, useAction, useToast } from '../../ui.jsx';
import NbtEditor from './NbtEditor.jsx';

const join = (dir, name) => (dir ? `${dir}/${name}` : name);
const parentOf = (p) => p.split('/').slice(0, -1).join('/');

/** Lee carpetas arrastradas al navegador (incluidas subcarpetas). */
async function filesFromDrop(dataTransfer) {
  const items = [...(dataTransfer.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!items.length) return [...dataTransfer.files].map((file) => ({ file, rel: file.name }));
  const out = [];
  const readAll = (reader) =>
    new Promise((resolve) => {
      const all = [];
      const next = () => reader.readEntries((batch) => (batch.length ? (all.push(...batch), next()) : resolve(all)), () => resolve(all));
      next();
    });
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, rel: prefix + file.name });
    } else if (entry.isDirectory) {
      for (const child of await readAll(entry.createReader())) await walk(child, `${prefix}${entry.name}/`);
    }
  }
  for (const entry of items) await walk(entry, '');
  return out;
}

export default function FilesTab({ server, state }) {
  const [path, setPath] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const [nbt, setNbt] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [picker, setPicker] = useState(null); // 'move' | 'copy'
  const [dragging, setDragging] = useState(false);
  const [upload, setUpload] = useState(null); // { count, progress }
  const [search, setSearch] = useState('');
  const [results, setResults] = useState(null);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const [run, busy] = useAction();
  const toast = useToast();
  const base = `/servers/${server.id}/files`;
  const running = ['running', 'starting', 'stopping'].includes(state);

  const load = useCallback(() => {
    setError('');
    return api(`${base}?${qs({ path })}`)
      .then((d) => {
        setData(d);
        setSelected(new Set());
      })
      .catch((err) => setError(err.message));
  }, [base, path]);
  useEffect(() => {
    load();
  }, [load, running]);

  async function sendFiles(list) {
    if (!list.length) return;
    const form = new FormData();
    for (const { file, rel } of list) {
      form.append('paths', rel);
      form.append('files', file);
    }
    setUpload({ count: list.length, progress: 0 });
    try {
      const r = await uploadWithProgress(`${base}/upload?${qs({ path })}`, form, (p) => setUpload((u) => ({ ...u, progress: p })));
      toast(`${r.saved.length} archivo(s) subido(s)`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUpload(null);
    }
  }

  const crumbs = path ? path.split('/') : [];
  const selectedList = [...selected];
  const allSelected = data?.entries.length > 0 && selected.size === data.entries.length;
  const toggle = (name) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  const paths = (names) => names.map((n) => join(path, n));

  function openEntry(entry, fullPath) {
    if (entry.type === 'dir') {
      setResults(null);
      setPath(fullPath);
    } else if (entry.nbt) setNbt({ path: fullPath });
    else if (entry.editable) run(() => api(`${base}/content?${qs({ path: fullPath })}`).then((r) => setEditing({ path: fullPath, content: r.content })));
  }

  async function doSearch(e) {
    e.preventDefault();
    try {
      setResults(await api(`${base}/search?${qs({ q: search, path })}`));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div
      className="stack"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget) || setDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        sendFiles(await filesFromDrop(e.dataTransfer));
      }}
      style={dragging ? { outline: '2px dashed var(--prismarine)', outlineOffset: 6, borderRadius: 10 } : undefined}
    >
      {running && data?.protected && (
        <p className="note">
          El servidor está encendido y esta carpeta es del mundo: puedes ver, descargar y editar texto, pero no borrar, mover ni subir archivos aquí
          (podría dañar el mundo). La carpeta datapacks sí se puede modificar.
        </p>
      )}

      <div className="row">
        <nav className="crumbs grow" aria-label="Ruta">
          <button onClick={() => setPath('')}>servidor</button>
          {crumbs.map((c, i) => (
            <span key={i} className="row" style={{ gap: '0.15rem' }}>
              <span className="faint">/</span>
              <button onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))}>{c}</button>
            </span>
          ))}
        </nav>
        <form className="row" onSubmit={doSearch} style={{ gap: '0.4rem' }}>
          <input style={{ width: 200 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre" aria-label="Buscar archivos por nombre" />
          <button disabled={search.trim().length < 2}>Buscar</button>
        </form>
      </div>

      <div className="row">
        <button
          onClick={() => {
            const name = prompt('Nombre de la carpeta nueva');
            if (name) run(() => api(`${base}/mkdir`, { method: 'POST', body: { path: join(path, name) } }).then(load));
          }}
        >
          Nueva carpeta
        </button>
        <button
          onClick={() => {
            const name = prompt('Nombre del archivo nuevo', 'nuevo.txt');
            if (name) setEditing({ path: join(path, name), content: '', isNew: true });
          }}
        >
          Nuevo archivo
        </button>
        <button className="btn-go" disabled={Boolean(upload)} onClick={() => fileInput.current.click()}>
          Subir archivos
        </button>
        <button disabled={Boolean(upload)} onClick={() => folderInput.current.click()}>
          Subir carpeta
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            sendFiles([...e.target.files].map((file) => ({ file, rel: file.name })));
            e.target.value = '';
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          webkitdirectory=""
          directory=""
          onChange={(e) => {
            sendFiles([...e.target.files].map((file) => ({ file, rel: file.webkitRelativePath || file.name })));
            e.target.value = '';
          }}
        />
        <span className="faint small">También puedes arrastrar archivos y carpetas aquí.</span>
      </div>

      {upload && (
        <div className="stack" style={{ gap: '0.3rem' }}>
          <span className="muted small">
            Subiendo {upload.count} archivo(s)… {Math.round(upload.progress * 100)}%
          </span>
          <Progress value={upload.progress} />
        </div>
      )}

      {selected.size > 0 && !results && (
        <div className="selection-bar">
          <strong className="grow">{selected.size} seleccionado(s)</strong>
          <a className="btn btn-sm" href={`/api${base}/download-many?${qs({ paths: JSON.stringify(paths(selectedList)) })}`}>
            Descargar .zip
          </a>
          <button className="btn-sm" onClick={() => setPicker('copy')}>
            Copiar a…
          </button>
          <button className="btn-sm" onClick={() => setPicker('move')}>
            Mover a…
          </button>
          <button
            className="btn-sm"
            disabled={busy}
            onClick={() => run(() => api(`${base}/compress`, { method: 'POST', body: { paths: paths(selectedList) } }).then((r) => (load(), r)), 'Archivo .zip creado')}
          >
            Comprimir
          </button>
          <button className="btn-sm btn-stop" onClick={() => setConfirm({ names: selectedList })}>
            Borrar
          </button>
          <button className="btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
            Quitar selección
          </button>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {results ? (
        <section className="stack" style={{ gap: '0.5rem' }}>
          <div className="row">
            <span className="muted small grow">
              {results.results.length} resultado(s) para “{results.query}” {path ? `en ${path}` : 'en todo el servidor'}
              {results.truncated ? ' (se muestran los primeros)' : ''}.
            </span>
            <button className="btn-sm btn-ghost" onClick={() => setResults(null)}>
              Cerrar búsqueda
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {results.results.map((r) => (
                  <tr key={r.path}>
                    <td>
                      <button className="btn-sm btn-ghost" style={{ fontWeight: r.type === 'dir' ? 500 : 400 }} onClick={() => openEntry(r, r.path)}>
                        {r.type === 'dir' ? '▸ ' : ''}
                        {r.path}
                      </button>
                    </td>
                    <td className="muted">{r.type === 'dir' ? '' : formatBytes(r.size)}</td>
                    <td className="actions">
                      <button className="btn-sm" onClick={() => (setResults(null), setPath(r.type === 'dir' ? r.path : parentOf(r.path)))}>
                        Abrir carpeta
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        data && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(data.entries.map((x) => x.name)) : new Set())}
                      aria-label="Seleccionar todo"
                    />
                  </th>
                  <th>Nombre</th>
                  <th>Tamaño</th>
                  <th>Modificado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {path && (
                  <tr>
                    <td />
                    <td colSpan={4}>
                      <button className="btn-sm btn-ghost" onClick={() => setPath(parentOf(path))}>
                        .. (subir un nivel)
                      </button>
                    </td>
                  </tr>
                )}
                {data.entries.length === 0 && (
                  <tr>
                    <td />
                    <td colSpan={4} className="faint">
                      Carpeta vacía.
                    </td>
                  </tr>
                )}
                {data.entries.map((e) => {
                  const p = join(path, e.name);
                  const isWorld = !path && data.worlds.includes(e.name);
                  return (
                    <tr key={e.name} className={selected.has(e.name) ? 'row-selected' : ''}>
                      <td>
                        <input type="checkbox" checked={selected.has(e.name)} onChange={() => toggle(e.name)} aria-label={`Seleccionar ${e.name}`} />
                      </td>
                      <td>
                        {e.type === 'dir' || e.editable || e.nbt ? (
                          <button className="btn-sm btn-ghost" style={{ fontWeight: e.type === 'dir' ? 500 : 400 }} onClick={() => openEntry(e, p)}>
                            {e.type === 'dir' ? '▸ ' : ''}
                            {e.name}
                          </button>
                        ) : (
                          <span style={{ paddingLeft: '0.6rem' }}>{e.name}</span>
                        )}
                        {isWorld && <span className="chip" style={{ marginLeft: '0.4rem' }}>mundo</span>}
                        {e.nbt && <span className="faint small"> datos NBT</span>}
                      </td>
                      <td className="muted">{e.type === 'dir' ? '' : formatBytes(e.size)}</td>
                      <td className="muted">{formatDate(e.mtime)}</td>
                      <td className="actions">
                        {e.name.toLowerCase().endsWith('.zip') && (
                          <button
                            className="btn-sm"
                            disabled={busy}
                            onClick={() => run(() => api(`${base}/extract`, { method: 'POST', body: { path: p } }).then(load), 'Archivo extraído')}
                          >
                            Extraer
                          </button>
                        )}{' '}
                        <a className="btn btn-sm" href={`/api${base}/download?${qs({ path: p })}`}>
                          Descargar
                        </a>{' '}
                        <button
                          className="btn-sm"
                          onClick={() => {
                            const name = prompt('Nuevo nombre', e.name);
                            if (name && name !== e.name) run(() => api(`${base}/rename`, { method: 'POST', body: { from: p, to: join(path, name) } }).then(load));
                          }}
                        >
                          Renombrar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {editing && (
        <Editor
          file={editing}
          onClose={() => setEditing(null)}
          onSave={async (content) => {
            await api(`${base}/content`, { method: 'PUT', body: { path: editing.path, content } });
            toast('Archivo guardado');
            setEditing(null);
            load();
          }}
        />
      )}

      {nbt && (
        <NbtEditor
          serverId={server.id}
          path={nbt.path}
          running={running}
          onClose={() => setNbt(null)}
          onSaved={() => {
            toast('Datos guardados (se dejó una copia .panel-bak)');
            load();
          }}
        />
      )}

      {picker && (
        <FolderPicker
          base={base}
          title={`${picker === 'move' ? 'Mover' : 'Copiar'} ${selected.size} elemento(s) a…`}
          start={path}
          confirmLabel={picker === 'move' ? 'Mover aquí' : 'Copiar aquí'}
          onClose={() => setPicker(null)}
          onPick={(dest) =>
            run(async () => {
              const r = await api(`${base}/${picker}`, { method: 'POST', body: { paths: paths(selectedList), dest } });
              setPicker(null);
              await load();
              return r;
            }, picker === 'move' ? 'Movido' : 'Copiado')
          }
        />
      )}

      {confirm && (
        <Confirm
          title={confirm.names.length === 1 ? `Borrar ${confirm.names[0]}` : `Borrar ${confirm.names.length} elementos`}
          message="Las carpetas se borran con todo su contenido. No se puede deshacer; si dudas, descarga una copia o haz un respaldo antes."
          confirmLabel="Borrar"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => run(() => api(`${base}/delete`, { method: 'POST', body: { paths: paths(confirm.names) } }).then(load), 'Borrado')}
        />
      )}
    </div>
  );
}

function FolderPicker({ base, title, start, confirmLabel, onClose, onPick }) {
  const [path, setPath] = useState(start);
  const [dirs, setDirs] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setDirs(null);
    api(`${base}?${qs({ path })}`)
      .then((d) => setDirs(d.entries.filter((e) => e.type === 'dir')))
      .catch((err) => setError(err.message));
  }, [base, path]);
  return (
    <Modal title={title} onClose={onClose}>
      <p className="mono small">/{path}</p>
      {error && <div className="error-box">{error}</div>}
      <div className="folder-list">
        {path && (
          <button className="file-pick" onClick={() => setPath(parentOf(path))}>
            .. (subir un nivel)
          </button>
        )}
        {dirs?.map((d) => (
          <button key={d.name} className="file-pick" onClick={() => setPath(join(path, d.name))}>
            ▸ {d.name}
          </button>
        ))}
        {dirs?.length === 0 && <p className="faint small">Sin subcarpetas.</p>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose}>Cancelar</button>
        <button className="btn-go" onClick={() => onPick(path)}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function Editor({ file, onClose, onSave }) {
  const [content, setContent] = useState(file.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = content !== file.content || file.isNew;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(content);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={file.path} onClose={() => (!dirty || confirm('¿Descartar los cambios?')) && onClose()} wide>
      <textarea
        className="editor"
        value={content}
        spellCheck={false}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            save();
          }
        }}
      />
      {error && <div className="error-box">{error}</div>}
      <div className="row">
        <span className="faint small grow">Ctrl+S para guardar. Muchos cambios necesitan reiniciar el servidor.</span>
        <button onClick={onClose}>Cancelar</button>
        <button className="btn-go" disabled={saving || !dirty} onClick={save}>
          Guardar
        </button>
      </div>
    </Modal>
  );
}
