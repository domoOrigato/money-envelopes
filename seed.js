// The phone app starts empty. Load a backup from the computer app, or add statements, to fill it.
window.SEED = {
  income: 0,
  tx: [],
  plan: [
    { line: 'Rent', group: 'Bills', plan: 0, note: '' },
    { line: 'Hydro', group: 'Bills', plan: 0, note: '' },
    { line: 'Phone', group: 'Bills', plan: 0, note: '' },
    { line: 'Groceries & household', group: 'Needs', plan: 0, note: '' },
    { line: 'Getting around', group: 'Needs', plan: 0, note: '' },
    { line: 'Fun money', group: 'Wants', plan: 0, note: '' },
    { line: 'Emergency fund', group: 'Saving', plan: 0, note: '' },
  ],
};
