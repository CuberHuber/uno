import { useState } from 'react';

export default function RuleRow({ name, desc, details, on, onToggle }: {
  name: string; desc: string; details?: string; on: boolean; onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rulerow-wrap">
      <button type="button" className="rulerow" role="switch" aria-checked={on} onClick={onToggle}>
        <span className="rulerow-text">
          <span className="rulerow-name">{name}</span>
          <span className="rulerow-desc">{desc}</span>
        </span>
        {details && (
          <span role="button" tabIndex={0} className="rulerow-q" aria-expanded={open}
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setOpen((o) => !o); } }}>
            ?
          </span>
        )}
        <span className={`rulerow-track${on ? ' rulerow-track-on' : ''}`}>
          <span className="rulerow-knob" />
        </span>
      </button>
      {details && open && <p className="rulerow-details">{details}</p>}
    </div>
  );
}
