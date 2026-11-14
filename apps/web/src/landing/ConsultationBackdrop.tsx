import Image from "next/image";

/** One persistent image behind all six walkthrough scenes. */
export function ConsultationBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-[#15171a]"
    >
      <Image
        src="/landing/consultation-courtyard-cartoon.png"
        alt=""
        fill
        sizes="(min-width:1440px) 740px, (min-width:1024px) 55vw, 90vw"
        quality={85}
        className="object-cover object-center"
      />
    </div>
  );
}
