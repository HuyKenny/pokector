/**
 * Blog content registry. Articles are MDX files in app/content/blog/; the
 * filename (minus extension) is the slug. Frontmatter is exported by
 * remark-mdx-frontmatter at build time — no runtime filesystem access needed
 * (Workers have none).
 */

import type { ComponentType } from "react";

export interface BlogFrontmatter {
  title: string;
  description: string;
  /** "YYYY-MM-DD" */
  date: string;
  category: string;
}

interface MdxModule {
  default: ComponentType;
  frontmatter: BlogFrontmatter;
}

const modules = import.meta.glob<MdxModule>("../content/blog/*.mdx", { eager: true });

export interface BlogPost {
  slug: string;
  frontmatter: BlogFrontmatter;
  Component: ComponentType;
}

export const BLOG_POSTS: BlogPost[] = Object.entries(modules)
  .map(([path, module]) => ({
    slug: path.replace(/^.*\//, "").replace(/\.mdx$/, ""),
    frontmatter: module.frontmatter,
    Component: module.default,
  }))
  .sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));

export const BLOG_CATEGORIES = [...new Set(BLOG_POSTS.map((p) => p.frontmatter.category))].sort();

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

export const BLOG_PAGE_SIZE = 10;
