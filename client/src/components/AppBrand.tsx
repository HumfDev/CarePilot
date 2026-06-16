type AppBrandVariant = 'header' | 'compact' | 'icon';

interface AppBrandProps {
  variant?: AppBrandVariant;
  className?: string;
}

const ICON_SRC = '/brand/carepilot-icon.png';
const LOGO_SRC = '/brand/carepilot-logo-full.png';

/** CarePilot brand mark — icon + wordmark sized for light UI surfaces. */
export function AppBrand({ variant = 'header', className = '' }: AppBrandProps) {
  if (variant === 'icon') {
    return (
      <img
        src={ICON_SRC}
        alt=""
        aria-hidden="true"
        className={`h-8 w-8 shrink-0 object-contain ${className}`}
      />
    );
  }

  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2.5 ${className}`}>
        <img src={ICON_SRC} alt="" aria-hidden="true" className="h-7 w-7 shrink-0 object-contain" />
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold tracking-tight text-[#3d6f9b]">
            CareP<span className="text-[#9cc24e]">i</span>lot
          </p>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">
            Referral Copilot
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <img
        src={LOGO_SRC}
        alt="CarePilot — Guiding your healthcare journey"
        className="h-10 w-auto max-w-[min(14rem,42vw)] object-contain object-left"
      />
      <div className="hidden min-w-0 border-l border-neutral-200 pl-3 sm:block">
        <p className="text-[11px] font-semibold text-neutral-800">Referral Copilot</p>
        <p className="text-[10px] text-neutral-500">Evidence-aware facility search</p>
      </div>
    </div>
  );
}
