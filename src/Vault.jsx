import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileLock2, Upload, Download, Eye, EyeOff, X, LockKeyhole, ShieldCheck, ArrowUpRight, File, CircleCheck } from 'lucide-react';
import { sealFile, openFile, MAX_FILE_SIZE } from './vault-crypto';

export default function Vault() {
  const [mode, setMode] = useState('encrypt'), [file, setFile] = useState(null), [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [show, setShow] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(null);
  const epoch = useRef(0), picker = useRef(null);
  useEffect(() => () => { epoch.current++; }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  const clear = () => { epoch.current++; setBusy(false); setFile(null); setPassword(''); setConfirm(''); setShow(false); setResult(null); setError(''); if(picker.current) picker.current.value = ''; };
  const choose = f => { setError(''); setResult(null); if (!f) return; if (f.size > MAX_FILE_SIZE + (mode === 'decrypt' ? 8192 : 0)) { setFile(null); if(picker.current) picker.current.value = ''; setError('Choose a file no larger than 20 MB'); return; } setFile(f); };
  async function processFile(e) {
    e.preventDefault(); if (busy || !file) return;
    if (mode === 'encrypt' && password !== confirm) return setError('The passphrases do not match');
    setBusy(true); setError(''); setResult(null); const captured = ++epoch.current;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let output;
      try {
        output = mode === 'encrypt' ? { bytes: await sealFile(bytes, file.name, file.type, password), name: 'sealed.onegate', type: 'application/octet-stream' } : await openFile(bytes, password);
      } finally { bytes.fill(0); }
      if (captured !== epoch.current) return;
      setResult({ url: URL.createObjectURL(new Blob([output.bytes], { type: 'application/octet-stream' })), name: output.name, size: output.bytes.length });
      output.bytes.fill(0); setPassword(''); setConfirm('');
    } catch (e) { if (captured === epoch.current) setError(e.message); }
    finally { if (captured === epoch.current) setBusy(false); }
  }
  return <main className="page vault-page"><div className="page-heading"><span className="eyebrow">On your device</span><h1>Your file, under lock</h1><p>Encrypt a file before sharing it, or unlock an existing Onegate file</p></div><div className="vault-layout"><section className="vault-tool"><div className="vault-tabs" role="group" aria-label="Vault mode">{['encrypt','decrypt'].map(v => <button key={v} aria-pressed={mode===v} disabled={busy} onClick={() => { clear(); setMode(v); }}>{v === 'encrypt' ? 'Encrypt file' : 'Decrypt file'}</button>)}</div><form onSubmit={processFile}><label className={'file-drop '+(file?'has-file':'')} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault(); if (!busy) choose(e.dataTransfer.files[0]);}}><input ref={picker} type="file" disabled={busy} aria-label="Choose file" accept={mode==='decrypt'?'.onegate':undefined} onChange={e=>choose(e.target.files[0])}/>{file ? <File size={34}/> : <Upload size={34}/>}<strong>{file ? file.name : 'Choose a file or drop it here'}</strong><span>{file ? `${(file.size/1024).toFixed(1)} KB` : 'Up to 20 MB / processed locally'}</span></label><label className="field-label">Passphrase<div className="password-field"><input aria-label="Passphrase" type={show?'text':'password'} autoComplete="off" value={password} disabled={busy} minLength={12} maxLength={1024} required onChange={e=>{setPassword(e.target.value);setResult(null);}} placeholder={mode==='encrypt'?'At least 12 characters':'Your original passphrase'}/><button type="button" className="icon-button" aria-label={show?'Hide passphrase':'Show passphrase'} onClick={()=>setShow(!show)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>{mode==='encrypt'&&<label className="field-label">Confirm passphrase<input aria-label="Confirm passphrase" type={show?'text':'password'} value={confirm} disabled={busy} required autoComplete="off" onChange={e=>setConfirm(e.target.value)} placeholder="Repeat your passphrase"/></label>}<p className="field-note">Keep the passphrase separate from your file. Onegate cannot reset or recover it.</p>{error&&<p role="alert" className="form-error">{error}</p>}<div className="vault-actions"><button className="button dark" disabled={!file||busy||password.length<12}>{busy?'Processing locally':mode==='encrypt'?'Encrypt file':'Decrypt file'}<LockKeyhole size={17}/></button><button className="text-link" type="button" onClick={clear}><X size={16}/>Clear session</button></div>{result&&<div className="vault-result" role="status"><CircleCheck size={23}/><div><b>{mode==='encrypt'?'Encrypted file ready':'File decrypted'}</b><span>{result.name}</span></div><a className="button dark" download={result.name} href={result.url}>Download<Download size={16}/></a></div>}</form></section><aside className="vault-aside"><FileLock2 size={55} strokeWidth={1}/><h2>A file vault<br />without an account</h2><p>The content and original filename are encrypted in this browser. Only the encrypted download leaves when you choose to share it.</p><ul><li><ShieldCheck size={17}/>AES-256-GCM</li><li><LockKeyhole size={17}/>Unique salt and nonce per file</li><li><FileLock2 size={17}/>No upload or cloud storage</li></ul><p className="field-note">Encrypted size remains visible. A compromised device can still expose files or passphrases. Test decryption before deleting your original.</p><Link to="/docs#vault" className="text-link">Encryption details<ArrowUpRight size={17}/></Link></aside></div></main>;
}
