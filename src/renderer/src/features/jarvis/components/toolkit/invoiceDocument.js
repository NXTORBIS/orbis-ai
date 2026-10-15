export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const money = (value, currency) => {
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

export const invoiceTotals = (invoice) => {
  const lines = (invoice.items || []).map((item) => {
    const amount = (Number(item.qty) || 0) * (Number(item.rate) || 0);
    return { ...item, amount };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const discount = subtotal * ((Number(invoice.discountPct) || 0) / 100);
  const taxable = subtotal - discount;
  const tax = taxable * ((Number(invoice.taxPct) || 0) / 100);
  const total = taxable + tax;
  const paid = Number(invoice.paid) || 0;
  return { lines, subtotal, discount, taxable, tax, total, paid, balance: total - paid, isPaid: paid >= total && total > 0 };
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

export const buildInvoiceHtml = (invoice) => {
  const currency = invoice.meta?.currency || 'USD';
  const accent = invoice.meta?.accent || '#0ea5e9';
  const { lines, subtotal, discount, tax, total, paid, balance, isPaid } = invoiceTotals(invoice);

  const rowHtml = lines.length
    ? lines.map((line) => `
      <tr>
        <td>${escapeHtml(line.description) || '<span class="muted">Item</span>'}</td>
        <td class="num">${escapeHtml(line.qty)}</td>
        <td class="num">${escapeHtml(money(line.rate, currency))}</td>
        <td class="num strong">${escapeHtml(money(line.amount, currency))}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="muted">No line items yet.</td></tr>';

  const totalRow = (label, value, strong) =>
    `<div class="trow${strong ? ' strong' : ''}"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${escapeHtml(invoice.meta?.number)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 22px; background: #eef2f7; color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  .paper { position: relative; max-width: 794px; margin: 0 auto; background: #fff; border-radius: 14px; padding: 42px;
    box-shadow: 0 14px 44px rgba(15, 23, 42, 0.14); overflow: hidden; }
  .bar { position: absolute; inset: 0 0 auto 0; height: 6px; background: ${accent}; }
  header { display: flex; flex-wrap: wrap; gap: 20px; justify-content: space-between; padding-bottom: 20px;
    border-bottom: 1px solid #e2e8f0; }
  .brand { font-size: 12px; line-height: 1.6; color: #475569; max-width: 300px; }
  .brand strong { display: block; color: #0f172a; font-size: 17px; letter-spacing: 0.01em; margin-bottom: 4px; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 30px; letter-spacing: 0.16em; text-transform: uppercase; color: #0f172a; }
  .title .num { margin-top: 6px; font-size: 13px; color: #475569; }
  .meta { display: flex; flex-wrap: wrap; gap: 32px; margin: 26px 0; }
  .meta div { font-size: 12px; line-height: 1.7; color: #475569; }
  .meta h2 { margin: 0 0 6px; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: #94a3b8; }
  .meta strong { color: #0f172a; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #64748b;
    padding: 0 8px 8px; border-bottom: 1px solid #e2e8f0; }
  td { padding: 11px 8px; font-size: 13px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  td.strong { font-weight: 600; }
  .muted { color: #94a3b8; }
  .totals { margin: 20px 0 0 auto; width: 100%; max-width: 320px; }
  .trow { display: flex; justify-content: space-between; gap: 16px; padding: 7px 0; font-size: 13px; color: #334155; }
  .trow span:last-child { font-variant-numeric: tabular-nums; }
  .trow.strong { border-top: 2px solid #0f172a; margin-top: 6px; padding-top: 11px; font-size: 16px;
    font-weight: 700; color: #0f172a; }
  .balance { display: flex; justify-content: space-between; margin-top: 10px; padding: 12px 14px; border-radius: 10px;
    background: #f8fafc; border: 1px solid #e2e8f0; font-size: 13px; font-weight: 600; }
  .notes { margin-top: 30px; padding-top: 18px; border-top: 1px solid #e2e8f0; display: flex; flex-wrap: wrap; gap: 28px; }
  .notes div { flex: 1 1 240px; font-size: 12px; line-height: 1.7; color: #475569; }
  .notes h2 { margin: 0 0 6px; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: #94a3b8; }
  .stamp { position: absolute; right: 58px; top: 214px; transform: rotate(-14deg); border: 3px solid #16a34a;
    color: #16a34a; padding: 6px 18px; border-radius: 10px; font-size: 22px; font-weight: 800;
    letter-spacing: 0.24em; opacity: 0.78; }
  @media (max-width: 620px) { .paper { padding: 26px; } .title h1 { font-size: 24px; } .stamp { right: 30px; top: 250px; } }
  @media print {
    body { background: #fff; padding: 0; }
    .paper { box-shadow: none; border-radius: 0; max-width: none; padding: 0; }
    @page { size: A4; margin: 14mm; }
  }
</style>
</head>
<body>
  <div class="paper">
    <div class="bar"></div>
    ${isPaid ? '<div class="stamp">PAID</div>' : ''}
    <header>
      <div class="brand">
        <strong>${escapeHtml(invoice.from?.name) || 'Your business'}</strong>
        ${invoice.from?.address ? `${escapeHtml(invoice.from.address).replace(/\n/g, '<br />')}<br />` : ''}
        ${invoice.from?.email ? `${escapeHtml(invoice.from.email)}<br />` : ''}
        ${invoice.from?.phone ? `${escapeHtml(invoice.from.phone)}<br />` : ''}
        ${invoice.from?.taxId ? `Tax ID: ${escapeHtml(invoice.from.taxId)}` : ''}
      </div>
      <div class="title">
        <h1>Invoice</h1>
        <div class="num">${escapeHtml(invoice.meta?.number)}</div>
      </div>
    </header>

    <div class="meta">
      <div>
        <h2>Billed to</h2>
        <strong>${escapeHtml(invoice.to?.name) || 'Client'}</strong><br />
        ${invoice.to?.address ? `${escapeHtml(invoice.to.address).replace(/\n/g, '<br />')}<br />` : ''}
        ${invoice.to?.email ? escapeHtml(invoice.to.email) : ''}
      </div>
      <div>
        <h2>Issued</h2>
        ${escapeHtml(formatDate(invoice.meta?.issueDate))}
      </div>
      <div>
        <h2>Due</h2>
        ${escapeHtml(formatDate(invoice.meta?.dueDate))}
      </div>
      <div>
        <h2>Amount</h2>
        <strong>${escapeHtml(money(total, currency))}</strong>
      </div>
    </div>

    <table>
      <thead>
        <tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>${rowHtml}</tbody>
    </table>

    <div class="totals">
      ${totalRow('Subtotal', money(subtotal, currency))}
      ${Number(invoice.discountPct) ? totalRow(`Discount (${escapeHtml(invoice.discountPct)}%)`, `−${money(discount, currency)}`) : ''}
      ${Number(invoice.taxPct) ? totalRow(`Tax (${escapeHtml(invoice.taxPct)}%)`, money(tax, currency)) : ''}
      ${totalRow('Total', money(total, currency), true)}
      ${paid ? totalRow('Paid', `−${money(paid, currency)}`) : ''}
    </div>

    ${paid ? `<div class="balance"><span>Balance due</span><span>${escapeHtml(money(balance, currency))}</span></div>` : ''}

    <div class="notes">
      ${invoice.notes ? `<div><h2>Notes</h2>${escapeHtml(invoice.notes).replace(/\n/g, '<br />')}</div>` : ''}
      ${invoice.terms ? `<div><h2>Terms</h2>${escapeHtml(invoice.terms).replace(/\n/g, '<br />')}</div>` : ''}
    </div>
  </div>
</body>
</html>`;
};