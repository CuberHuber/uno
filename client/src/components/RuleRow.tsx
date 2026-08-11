export default function RuleRow({ name, desc, on, onToggle }: {
  name: string; desc: string; on: boolean; onToggle: () => void;
}) {
  return (
    <button type="button" className="rulerow" role="switch" aria-checked={on} onClick={onToggle}>
      <span className="rulerow-text">
        <span className="rulerow-name">{name}</span>
        <span className="rulerow-desc">{desc}</span>
      </span>
      <span className={`rulerow-track${on ? ' rulerow-track-on' : ''}`}>
        <span className="rulerow-knob" />
      </span>
    </button>
  );
}
