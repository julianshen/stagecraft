import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import InspectorBody from './InspectorBody.jsx';

const LABELS = { design: 'Design', props: 'Props' };

describe('InspectorBody', () => {
  it('seeds the design tab\'s layout grid from the slide and forwards picks to onChangeLayout', () => {
    const onChangeLayout = vi.fn();
    const { getByLabelText } = render(
      <InspectorBody
        labels={LABELS} tab="design" setTab={vi.fn()}
        slide={{ layout: 'kpi' }} deck={{ theme: 'indigo' }}
        onChangeTheme={vi.fn()} onAddComponent={vi.fn()} onChangeLayout={onChangeLayout}
      />
    );
    expect(getByLabelText('KPI grid layout').className).toContain('on'); // current = slide.layout
    fireEvent.click(getByLabelText('Table layout'));
    expect(onChangeLayout).toHaveBeenCalledWith('table');
  });

  it('renders the design tab with no current layout when there is no slide (read-only safe)', () => {
    const { getByLabelText } = render(
      <InspectorBody labels={LABELS} tab="design" setTab={vi.fn()} deck={{}} />
    );
    expect(getByLabelText('Cover layout').className).not.toContain('on'); // nothing active, no crash
  });
});
