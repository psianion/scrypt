// d3-force-3d ships no TypeScript types (and none exist on DefinitelyTyped).
// Minimal ambient shape covering the forces projector.ts actually uses — loose
// `any` on purpose, this is a one-shot layout pass, not a typed API surface.
declare module "d3-force-3d" {
  export interface Force3DNode {
    id?: string;
    x?: number;
    y?: number;
    z?: number;
    [key: string]: unknown;
  }

  export interface Force {
    (alpha: number): void;
    [method: string]: any;
  }

  export interface Simulation3D {
    force(name: string, force: Force | null): Simulation3D;
    tick(iterations?: number): Simulation3D;
    stop(): Simulation3D;
    nodes(): Force3DNode[];
    alphaDecay(decay?: number): Simulation3D;
    alphaMin(min?: number): Simulation3D;
  }

  export function forceSimulation(nodes?: Force3DNode[], numDimensions?: number): Simulation3D;
  export function forceManyBody(): Force;
  export function forceLink(links?: unknown[]): Force;
  export function forceCollide(radius?: number | ((d: any) => number)): Force;
  export function forceCenter(x?: number, y?: number, z?: number): Force;
  export function forceX(x?: number | ((d: any) => number)): Force;
  export function forceY(y?: number | ((d: any) => number)): Force;
  export function forceZ(z?: number | ((d: any) => number)): Force;
}
