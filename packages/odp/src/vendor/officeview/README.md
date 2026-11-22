# OfficeView reuse

`units.js` adapts only `lengthEmu` from `src/odf/units.ts` at OfficeView commit
`dc73bda86e07e9ed0317cb9f91781cce14a39b21` (MIT, Julian Shen). Changes: JavaScript,
strict decimal syntax, null handling and table-based conversion. This pin is
independent of Stagecraft's unmodified drawing engine vendor pin.

Source: https://github.com/julianshen/officeview/blob/dc73bda86e07e9ed0317cb9f91781cce14a39b21/src/odf/units.ts
