import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PropsPanel from './PropsPanel.jsx';

const base = { id: 'shape', type: 'text', x: 12, y: 23, w: 34, h: 45, rot: 56, opacity: 67, fontSize: 78 };

describe('inspector numeric edits and incomplete elements', () => {
  it.each([['x',12], ['y',23], ['w',34], ['h',45], ['rot',56], ['opacity',67]])('commits and clears %s without changing the other properties', (key, initial) => {
    const update = vi.fn();
    render(<PropsPanel selected={base} setSelected={update} />);
    const input = screen.getByDisplayValue(String(initial));
    fireEvent.change(input, { target: { value: '91' } });
    expect(update).toHaveBeenLastCalledWith({ ...base, [key]: 91 });
    fireEvent.change(input, { target: { value: '' } });
    expect(update).toHaveBeenLastCalledWith({ ...base, [key]: 0 });
  });
  it('renders a missing type/content safely and restores the default font size on clear', () => {
    const update = vi.fn();
    const { rerender } = render(<PropsPanel selected={{ id:'unknown' }} setSelected={update} />);
    expect(screen.getByRole('heading', { name: 'Element' })).toBeInTheDocument();
    rerender(<PropsPanel selected={base} setSelected={update} />);
    expect(screen.getAllByRole('textbox').find(node => node.tagName === 'TEXTAREA')).toHaveValue('');
    fireEvent.change(screen.getByDisplayValue('78'), { target:{value:''} });
    expect(update).toHaveBeenLastCalledWith({...base,fontSize:48});
  });
  it('clears gradient angle, disables a stroke without discarding its color, and normalizes shadow offsets', () => {
    const selected={...base,type:'rect',stroke:'#123456',strokeWidth:4,gradient:{from:'#112233',to:'#445566',angle:30},shadow:{color:'#123456',blur:10,x:3,y:4}};
    const update=vi.fn();render(<PropsPanel selected={selected} setSelected={update}/>);
    fireEvent.change(screen.getByLabelText('Gradient angle'),{target:{value:''}});
    expect(update).toHaveBeenLastCalledWith({...selected,gradient:{...selected.gradient,angle:0}});
    fireEvent.change(screen.getByLabelText('Stroke width'),{target:{value:''}});
    expect(update).toHaveBeenLastCalledWith({...selected,strokeWidth:0});
    for(const [key,label] of [['blur','Shadow blur'],['x','Shadow X'],['y','Shadow Y']]){
      fireEvent.change(screen.getByLabelText(label),{target:{value:'-5'}});
      expect(update).toHaveBeenLastCalledWith({...selected,shadow:{...selected.shadow,[key]:key==='blur'?0:-5}});
      fireEvent.change(screen.getByLabelText(label),{target:{value:''}});
      expect(update).toHaveBeenLastCalledWith({...selected,shadow:{...selected.shadow,[key]:0}});
    }
  });
});
