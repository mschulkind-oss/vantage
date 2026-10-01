import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { shouldHandleInternalNavigation } from "../lib/navigation";
import { routeHref } from "../lib/staticMode";

interface AppLinkProps extends Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "onClick"
> {
  /** The SPA route to navigate to (also used as href) */
  to: string;
  /** Optional click handler called before navigation. Return false to prevent. */
  onBeforeNavigate?: (e: React.MouseEvent<HTMLAnchorElement>) => boolean | void;
  children: React.ReactNode;
}

/**
 * A link component that supports SPA navigation on normal click,
 * while allowing ctrl+click/cmd+click/middle-click to open in a new tab.
 *
 * Use this instead of <span onClick={() => navigate(path)}> or
 * <button onClick={() => navigate(path)}> for all navigable elements.
 */
export const AppLink: React.FC<AppLinkProps> = ({
  to,
  onBeforeNavigate,
  children,
  ...props
}) => {
  const navigate = useNavigate();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Let browser handle ctrl+click, cmd+click, middle-click, shift+click
      if (!shouldHandleInternalNavigation(e)) {
        return;
      }

      // Call optional pre-navigation handler
      if (onBeforeNavigate) {
        const result = onBeforeNavigate(e);
        if (result === false) return;
      }

      e.preventDefault();
      navigate(to);
    },
    [navigate, to, onBeforeNavigate],
  );

  // The route as the router reads it: in a static export, the hash route, so
  // that "Copy link" and a middle-click reach what a click does (`routeHref`).
  return (
    <a href={routeHref(to)} onClick={handleClick} {...props}>
      {children}
    </a>
  );
};
