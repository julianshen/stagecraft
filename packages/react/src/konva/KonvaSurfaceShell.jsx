import { Component } from 'react';
import KonvaStage from './KonvaStage.jsx';

class KonvaErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    this.props.onError?.(error);
  }
  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function KonvaSurfaceShell({
  scene,
  revision,
  ownerKey,
  policyKey,
  selectionId,
  zoom = 100,
  readOnly = false,
  canMove,
  fontEpochBump = 0,
  onSelect,
  onMove,
  onRequestTextEdit,
  onUseSvg,
  onRenderError,
  onError,
}) {
  return (
    <div className="stagecraft-konva-surface">
      <div className="stagecraft-konva-controls">
        <button type="button" className="stagecraft-konva-escape" onClick={onUseSvg}>
          Switch to standard view
        </button>
        <div role="group" aria-label="Canvas objects" className="stagecraft-konva-object-list">
          {scene.nodes.map((node, index) => (
            <button
              key={node.id}
              type="button"
              aria-label={`Select object ${node.id}`}
              aria-pressed={selectionId === node.id}
              onClick={() => onSelect?.(node.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' && (node.type === 'text' || node.textIds.length > 0)) {
                  event.preventDefault();
                  onRequestTextEdit?.(node.id);
                }
              }}
            >
              {node.type === 'text' ? `Text ${index + 1}` : `Shape ${index + 1}`}
            </button>
          ))}
        </div>
      </div>
      <div className="stagecraft-presentation-paper stagecraft-konva-paper" style={{ width: `${960 * zoom / 100}px` }}>
        <KonvaErrorBoundary resetKey={`${scene.slideId}:${revision}:${fontEpochBump}`} onError={onRenderError}>
          <KonvaStage
            scene={scene}
            revision={revision}
            ownerKey={ownerKey}
            policyKey={policyKey}
            selectionId={selectionId}
            zoom={zoom}
            readOnly={readOnly}
            canMove={canMove}
            fontEpochBump={fontEpochBump}
            onSelect={onSelect}
            onMove={onMove}
            onRequestTextEdit={onRequestTextEdit}
            onError={onError}
          />
        </KonvaErrorBoundary>
      </div>
    </div>
  );
}
