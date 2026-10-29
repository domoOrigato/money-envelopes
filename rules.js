// Sorting rules: which envelope each transaction belongs in.
// The first rule that matches wins. "Income" and "Ignore" are special:
// Ignore is for money moving between your own accounts, so it isn't counted twice.
(function (root) {
  const INCOME = 'Income';
  const IGNORE = 'Ignore (transfer)';

  // [pattern, envelope, which accounts: 'card', 'bank' or undefined for any]
  const RULES = [
    // Card side of a card payment, and interest the card adds to its own balance
    [/^PAYMENT\b|PAYMENT - THANK YOU/i, IGNORE, 'card'],
    [/INTEREST/i, IGNORE, 'card'],

    // Money moving between your own accounts
    [/ONLINE BANKING TRANSFER|FIND & SAVE/i, IGNORE, 'bank'],

    // Income
    [/PAYROLL|E-TRANSFER RECEIVED|MOBILE CHEQUE/i, INCOME, 'bank'],

    // Everything else is learned from your backup file and from the envelopes you pick,
    // so this public copy doesn't carry your stores or bills.
  ];

  function isCard(acct) { return !/CHEQUING|SAVINGS/i.test(acct); }

  function categorize(tx) {
    const card = isCard(tx.a);
    for (const [re, env, where] of RULES) {
      if (where === 'card' && !card) continue;
      if (where === 'bank' && card) continue;
      if (re.test(tx.s)) return env;
    }
    return null; // needs a home
  }

  const api = { categorize, INCOME, IGNORE };
  if (typeof module !== 'undefined') module.exports = api; else root.Rules = api;
})(this);
