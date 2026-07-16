import { describe, expect, it } from "vitest";
import { identityCube, parseCube } from "./cubeParser";

const TINY_CUBE = `# comment
TITLE "test lut"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;

describe("parseCube", () => {
  it("parses a minimal 2-point cube", () => {
    const lut = parseCube(TINY_CUBE);
    expect(lut.size).toBe(2);
    expect(lut.title).toBe("test lut");
    expect(lut.data.length).toBe(24);
    // last entry = white
    expect([...lut.data.slice(21)]).toEqual([1, 1, 1]);
  });

  it("red varies fastest (cube index order)", () => {
    const lut = parseCube(TINY_CUBE);
    // entry 1 → r=1,g=0,b=0
    expect([...lut.data.slice(3, 6)]).toEqual([1, 0, 0]);
    // entry 2 → r=0,g=1,b=0
    expect([...lut.data.slice(6, 9)]).toEqual([0, 1, 0]);
  });

  it("rejects wrong entry count", () => {
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0\n")).toThrow(/mismatch/);
  });

  it("rejects missing size", () => {
    expect(() => parseCube("0 0 0\n")).toThrow();
  });

  it("identityCube maps corners to themselves", () => {
    const id = identityCube(3);
    expect(id.data.length).toBe(81);
    expect([...id.data.slice(0, 3)]).toEqual([0, 0, 0]);
    expect([...id.data.slice(78)]).toEqual([1, 1, 1]);
  });
});
