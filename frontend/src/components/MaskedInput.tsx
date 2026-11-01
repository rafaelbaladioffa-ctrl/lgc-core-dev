import { applyMask } from '../utils/mask';

interface MaskedInputProps {
  mask: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  required?: boolean;
}

export function MaskedInput({ mask, value, onChange, onBlur, placeholder, required }: MaskedInputProps) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      required={required}
      onChange={(e) => onChange(applyMask(e.target.value, mask))}
      onBlur={onBlur}
      inputMode="numeric"
    />
  );
}
