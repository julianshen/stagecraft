import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Slide, LineChart, AreaChart, DonutChart, ElementsLayer, sectionOf } from './SlideRenderer.jsx';

it('uses fallback chart categories and finite geometry for empty and zero data', () => {
  const { container, rerender }=render(<LineChart categories={[]} />);
  expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
  expect(container.textContent).toContain('Q1');
  rerender(<AreaChart categories={[]} />);
  expect(container.textContent).toContain('Q1');
  rerender(<DonutChart categories={[]} values={[]} />);
  expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
  rerender(<DonutChart categories={['']} values={[0]} />);
  expect(container.textContent).toContain('Series 1');
  expect(container.textContent).toContain('0%');
  for(const path of container.querySelectorAll('path')) expect(path.getAttribute('d')).not.toMatch(/NaN|Infinity/);
});

it('draws one-category multi-series area charts without off-canvas labels or single-series dots',()=>{
  const {container}=render(<AreaChart editable categories={['Only']} series={[{name:'A',values:[30]},{name:'B',values:[40]}]} />);
  expect(screen.getByText('Only')).toBeInTheDocument();
  const labelBox = screen.getByText('Only').closest('foreignObject');
  expect(labelBox).toHaveAttribute('x', '0');
  expect(labelBox).toHaveAttribute('width', '120');
  expect(screen.getByText('A')).toBeInTheDocument();expect(screen.getByText('B')).toBeInTheDocument();
  expect(container.querySelectorAll('circle')).toHaveLength(0);
  const areas=container.querySelectorAll('path[fill-opacity="0.18"]');expect(areas).toHaveLength(2);
  expect(areas[0].getAttribute('fill')).not.toBe(areas[1].getAttribute('fill'));
  expect(container.textContent).toContain('50'); // rounded 1/2/5 axis ceiling
});

it('renders fallback titles for absent and unknown layouts and uses deck titles for covers',()=>{
  const {rerender}=render(<Slide deck={{title:''}} slide={{id:'s',layout:'future',title:'Future'}} />);
  expect(screen.getByRole('heading',{name:'Future'})).toBeInTheDocument();
  rerender(<Slide deck={{title:''}} slide={{id:'s',layout:'future'}} />);expect(screen.getByRole('heading',{name:'Untitled'})).toBeInTheDocument();
  rerender(<Slide slide={{id:'s',layout:'cover'}} deck={{title:'Deck title'}} />);expect(screen.getByRole('heading',{name:'Deck title'})).toBeInTheDocument();
  rerender(<Slide deck={{title:''}} slide={{id:'s',layout:'cover'}} />);expect(screen.getByRole('heading',{name:'Untitled'})).toBeInTheDocument();expect(screen.getByText('DECK')).toBeInTheDocument();
});

it('renders six-column table status badges and signed value colors',()=>{
  const {container}=render(<Slide deck={{title:''}} slide={{id:'s',layout:'table',columns:['Name','A','B','C','D','Status'],rows:[['Row','-2','+3','4','5','Ready']]}}/>);
  expect(screen.getByText('Ready').closest('[style*="border-radius"]')).toHaveStyle({borderRadius:'4px'});
  const minus=screen.getByText('-2').closest('[style*="color"]'),plus=screen.getByText('+3').closest('[style*="color"]');
  expect(minus.style.color).toBe('oklch(0.55 0.18 25)');expect(plus.style.color).toBe('oklch(0.45 0.14 155)');
  expect(container.querySelector('[style*="1.4fr"]')).toBeTruthy();
});

it('does not render object-valued list entries or null risks as literal objects',()=>{
  const {container,rerender}=render(<Slide deck={{title:''}} slide={{id:'s',layout:'list',items:[null,{},'Visible']}} />);
  expect(screen.getByText('Visible')).toBeInTheDocument();expect(container.textContent).not.toContain('[object Object]');expect(screen.queryByText('01')).not.toBeInTheDocument();
  rerender(<Slide deck={{title:''}} slide={{id:'s',layout:'risks',items:[null,{t:'Risk',d:'Mitigate',sev:'unknown'}]}}/>);
  expect(screen.getByText('Risk')).toBeInTheDocument();expect(screen.getByText('Mitigate')).toBeInTheDocument();
});

it('keeps path fallback styling and unknown shape geometry safe',()=>{
  const {container}=render(<ElementsLayer elements={[{id:'p',type:'path',points:[[0,0],[1,1]],x:0,y:0,w:10,h:10},{id:'u',type:'future',x:0,y:0,w:12,h:15}]} />);
  const path=container.querySelector('polyline');expect(path).toBeTruthy();expect(path.getAttribute('stroke-width')).toBe('2');expect(path.getAttribute('stroke')).toBeTruthy();
  expect(container.querySelector('[style*="border-radius: 8px"]')).toBeTruthy();
});

it('returns the owning section name or an empty string for orphan slides',()=>{
  const deck={sections:[{name:'First',slides:['a']},{name:'Second',slides:['b']}]};
  expect(sectionOf(deck,'b')).toBe('Second');expect(sectionOf(deck,'orphan')).toBe('');
});
