// "RM 1,234.50". Money is always shown to the sen, so a rate of 25 and a rate of
// 25.50 read as the same kind of figure, and a column of costs lines up.
export const formatRM = (amount) =>
  amount == null ? "—" : `RM ${Number(amount).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
