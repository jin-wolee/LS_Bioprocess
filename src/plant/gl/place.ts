import { Matrix4, Quaternion, Vector3 } from "three";

const upright = new Quaternion();

/** The matrix of an instance: a position and a scale, no rotation (everything on the floor is axis-aligned). */
export const placed = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Matrix4 => new Matrix4().compose(new Vector3(x, y, z), upright, new Vector3(sx, sy, sz));
