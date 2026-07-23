import { useState } from "react";

/**
 * Card thumbnail with a graceful broken-image fallback. Riftbound card art is
 * built from tcgplayerId; a handful of promo/sealed products have no image on
 * the TCGplayer CDN (404/403), which would otherwise render the browser's
 * broken-image icon. On error (or a null src) we render the same "No image"
 * placeholder used elsewhere. onError never fires during SSR, so this must be a
 * client component with its own state.
 */
export function CardImage({
  src,
  alt,
  imgClassName,
  fallbackClassName,
  fallbackText = "No image",
}: {
  src: string | null | undefined;
  alt: string;
  imgClassName: string;
  fallbackClassName: string;
  fallbackText?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className={fallbackClassName}>{fallbackText}</span>;
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={imgClassName}
    />
  );
}
