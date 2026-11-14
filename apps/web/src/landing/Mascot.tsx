import Image from "next/image";

export function Mascot({ size = 64, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/landing/mr-fund-avatar.png"
      alt=""
      width={size}
      height={size}
      sizes={`${size}px`}
      className={`object-contain ${className}`}
    />
  );
}
