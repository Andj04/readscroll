import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { startImport } from '../import/session';
import Icon from './Icon';

/**
 * Picks a PDF, EPUB or text file and opens the import screen.
 * The file is read on this device only.
 */
export default function ImportButton({ label = 'Import book', className = 'btn btn-primary' }: { label?: string; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  function handleFile(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    startImport(file);
    navigate('/import');
    if (input.current) input.current.value = ''; // the same file can be picked again
  }

  return (
    <>
      <button className={className} onClick={() => input.current?.click()}>
        <Icon name="upload" size={18} /> {label}
      </button>
      <input
        ref={input}
        type="file"
        accept=".pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain,text/markdown"
        hidden
        data-testid="import-input"
        onChange={(e) => handleFile(e.target.files)}
      />
    </>
  );
}
