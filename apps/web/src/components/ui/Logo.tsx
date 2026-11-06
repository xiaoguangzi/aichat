import { useId } from 'react';
import { cn } from '../../lib/utils';

/** Speech-bubble mark traced from the brand icon. The bubble is punched out so it picks up the surface behind it. */
const BUBBLE =
  'M380 246 L660 248 L696 258 L725 272 L748 288 L772 311 L796 344 L809 373 L815 397 L818 419 L818 563 L810 607 L801 630 L781 664 L761 688 L741 706 L713 724 L691 734 L661 742 L441 744 L322 846 L313 848 L309 845 L308 726 L272 701 L242 672 L220 640 L204 602 L198 569 L198 415 L204 384 L213 359 L231 328 L254 302 L277 283 L312 263 L352 250 L379 247 Z';

export function LogoMark({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = { sm: 'h-5 w-5', md: 'h-7 w-7', lg: 'h-12 w-12' }[size];
  const id = useId().replace(/:/g, '');
  const clip = `logo-clip-${id}`;
  const mask = `logo-mask-${id}`;
  return (
    <svg viewBox="0 0 1024 1024" className={cn('shrink-0 text-zinc-950 dark:text-zinc-100', s, className)} aria-hidden>
      <defs>
        <clipPath id={clip}>
          <path d={BUBBLE} />
        </clipPath>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <circle cx="510" cy="514" r="471" fill="white" />
          <path d={BUBBLE} fill="black" />
          <g clipPath={`url(#${clip})`} fill="none" stroke="white" strokeLinejoin="round" strokeLinecap="butt">
            <g strokeWidth="35">
              <path d="M198 441 H370 L460 357 H535" />
              <path d="M198 543 H415 L480 487 H615" />
              <path d="M345 680 L400 640 L430 621 H500" />
            </g>
            <g strokeWidth="29">
              <circle cx="590" cy="357" r="40.5" />
              <circle cx="670" cy="487" r="40.5" />
              <circle cx="555" cy="615" r="40.5" />
            </g>
          </g>
        </mask>
      </defs>
      <rect width="1024" height="1024" fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  );
}
