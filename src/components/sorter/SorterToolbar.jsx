import Icon from '../ui/Icon.jsx';
import { Button } from '../ui/Primitives.jsx';

export default function SorterToolbar({ mode, setMode, onBack }) {
  return (
    <div className="toolbar">
      <div className="group">
        <Button variant="ghost" icon="chevron-left" onClick={onBack}>Editor</Button>
      </div>
      <div className="group">
        <div className="seg" style={{ width: 220 }}>
          <button className={mode === 'grid' ? 'active' : ''} onClick={() => setMode('grid')}>
            <Icon name="grid" size={12}/> Grid
          </button>
          <button className={mode === 'outline' ? 'active' : ''} onClick={() => setMode('outline')}>
            <Icon name="outline" size={12}/> Outline
          </button>
        </div>
      </div>
      <div className="group">
        <Button variant="ghost" icon="filter">All sections</Button>
        <Button variant="ghost" icon="sort">By order</Button>
      </div>
      <div className="spacer"/>
      <div className="group" style={{ border: 0 }}>
        <Button variant="ghost" icon="plus">New section</Button>
        <Button variant="ghost" icon="ai">Rearrange with AI</Button>
      </div>
    </div>
  );
}
