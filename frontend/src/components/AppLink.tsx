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
  /**
   * Called before a click navigates this tab. Return false to prevent. Not
   * called for a click the browser follows itself: a modified or middle
   * click, or any click on a link whose `target` is other than `_self`.
   */
  onBeforeNavigate?: (e: React.MouseEvent<HTMLAnchorElement>) => boolean | void;
  children: React.ReactNode;
}

/**
 * Whether a link's `target` names a browsing context other than this one,
 * such as `_blank`: the browser opens it there, and this tab stays put.
 */
function targetsElsewhere(target: string | undefined): boolean {
  return (
    target !== undefined && target !== "" && target.toLowerCase() !== "_self"
  );
}

/**
 * A link component that supports SPA navigation on normal click,
 * while allowing ctrl+click/cmd+click/middle-click to open in a new tab.
 * A link given a `target` other than `_self`, such as `target="_blank"`, is
 * the browser's to follow on every click: it never navigates this tab.
 *
 * Use this instead of <span onClick={() => navigate(path)}> or
 * <button onClick={() => navigate(path)}> for all navigable elements.
 */
export const AppLink: React.FC<AppLinkProps> = ({
  to,
  onBeforeNavigate,
  children,
  target,
  ...props
}) => {
  const navigate = useNavigate();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Let browser handle ctrl+click, cmd+click, middle-click, shift+click,
      // and a link meant to open somewhere other than this tab.
      if (!shouldHandleInternalNavigation(e) || targetsElsewhere(target)) {
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
    [navigate, to, onBeforeNavigate, target],
  );

  // The route as the router reads it: in a static export, the hash route, so
  // that "Copy link" and a middle-click reach what a click does (`routeHref`).
  return (
    <a href={routeHref(to)} target={target} onClick={handleClick} {...props}>
      {children}
    </a>
  );
};
