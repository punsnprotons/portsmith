export function classNames(...inputs) {
  return inputs.filter(value => typeof value === 'string' && value).join(' ');
}

export function buttonModel({ label, disabled = false, className = '' }) {
  return { tag: 'button', label, disabled, className: classNames('button', className) };
}
