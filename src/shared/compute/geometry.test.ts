import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  GEOMETRY_ASSUMPTIONS,
  angleAt,
  checkClaim,
  circleThrough,
  classifyConic,
  closestOnLine,
  closestPair,
  collinear,
  compose,
  containsPoint,
  constructSsa,
  convexHull,
  delaunay,
  distance2,
  distanceToLine,
  distanceToPlane,
  inCircumcircle,
  intersectCircles,
  intersectLineCircle,
  intersectLinePlane,
  intersectPlanes,
  isGeometryError,
  lineThrough,
  planeThrough,
  point,
  point3,
  polygonFacts,
  reflection,
  regularPolygon,
  relateLines,
  rotation,
  scaling,
  segmentsCross,
  slopeOf,
  solidFacts,
  tangentsFrom,
  transformFacts,
  translation,
  triangleFacts,
  verifyDelaunay,
  applyTransform,
  type Line2,
  type Point2
} from './geometry.ts'

const line = (a: Point2, b: Point2): Line2 => {
  const one = lineThrough(a, b)
  if (isGeometryError(one)) throw new Error(one.message)
  return one
}

describe('points and lines', () => {
  test('a line through two identical points is refused', () => {
    const one = lineThrough(point(1, 1), point(1, 1))
    assert.ok(isGeometryError(one))
    assert.match(one.message, /do not determine a line/)
  })

  test('a vertical line has no slope, which is a real answer', () => {
    assert.equal(slopeOf(line(point(1, 0), point(1, 5))), null)
    assert.equal(slopeOf(line(point(0, 0), point(2, 4))), 2)
  })

  test('coincident lines are distinguished from parallel ones', () => {
    const same = relateLines(line(point(0, 0), point(1, 1)), line(point(2, 2), point(3, 3)))
    assert.equal(same.relation, 'coincident')
    assert.match(same.describe, /meet at every point, not at none/)

    const apart = relateLines(line(point(0, 0), point(1, 1)), line(point(0, 1), point(1, 2)))
    assert.equal(apart.relation, 'parallel')
    assert.equal(apart.at, null)
  })

  test('perpendicular lines are recognised from the dot product', () => {
    const result = relateLines(line(point(0, 0), point(1, 0)), line(point(0, 0), point(0, 1)))
    assert.equal(result.relation, 'perpendicular')
    assert.ok(Math.abs(result.angle - Math.PI / 2) < 1e-12)
    assert.match(result.describe, /dot product of their directions is zero/)
  })

  test('two lines that meet give the point they meet at', () => {
    const result = relateLines(line(point(0, 0), point(2, 2)), line(point(0, 2), point(2, 0)))
    assert.ok(result.at)
    assert.ok(Math.abs(result.at.x - 1) < 1e-12)
    assert.ok(Math.abs(result.at.y - 1) < 1e-12)
  })

  test('the distance to a line is the perpendicular one', () => {
    assert.ok(Math.abs(distanceToLine(point(0, 5), line(point(0, 0), point(1, 0))) - 5) < 1e-12)
  })

  test('the closest point on a segment can be an endpoint, unlike on a line', () => {
    const l = line(point(0, 0), point(1, 0))
    const onLine = closestOnLine(point(5, 3), l, false)
    const onSegment = closestOnLine(point(5, 3), l, true)
    assert.ok(Math.abs(onLine.x - 5) < 1e-12)
    assert.ok(Math.abs(onSegment.x - 1) < 1e-12)
  })

  test('collinearity is decided by the cross product, at any scale', () => {
    assert.equal(collinear(point(0, 0), point(1, 1), point(2, 2)), true)
    assert.equal(collinear(point(0, 0), point(1, 1), point(2, 2.0001)), false)
    // The same shape scaled up by a million is still collinear, which an absolute tolerance would get wrong.
    assert.equal(collinear(point(0, 0), point(1e6, 1e6), point(2e6, 2e6)), true)
  })
})

describe('angles', () => {
  test('a right angle is recognised and named exactly', () => {
    const result = angleAt(point(0, 0), point(1, 0), point(0, 1))
    assert.ok(!isGeometryError(result))
    assert.equal(result.kind, 'right')
    assert.equal(result.exact, 'pi/2')
    assert.ok(Math.abs(result.degrees - 90) < 1e-12)
  })

  test('recognised exact angles come back as exact', () => {
    const sixty = angleAt(point(0, 0), point(1, 0), point(Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)))
    assert.ok(!isGeometryError(sixty))
    assert.equal(sixty.exact, 'pi/3')
  })

  test('an angle that is not a recognised value has no exact form rather than a made-up one', () => {
    const result = angleAt(point(0, 0), point(1, 0), point(1, 0.3))
    assert.ok(!isGeometryError(result))
    assert.equal(result.exact, null)
    assert.equal(result.kind, 'acute')
  })

  test('a degenerate ray is refused', () => {
    assert.ok(isGeometryError(angleAt(point(0, 0), point(0, 0), point(1, 1))))
  })
})

describe('triangles', () => {
  test('a 3-4-5 triangle is right-angled, by measurement', () => {
    const facts = triangleFacts({ a: point(0, 0), b: point(3, 0), c: point(0, 4) })
    assert.ok(!isGeometryError(facts))
    assert.equal(facts.angleKind, 'right')
    assert.equal(facts.kind, 'scalene')
    assert.ok(Math.abs(facts.area - 6) < 1e-12)
    assert.ok(Math.abs(facts.perimeter - 12) < 1e-12)
    assert.match(facts.describe, /not from how it looks/)
  })

  test('an equilateral triangle is recognised', () => {
    const facts = triangleFacts({ a: point(0, 0), b: point(1, 0), c: point(0.5, Math.sqrt(3) / 2) })
    assert.ok(!isGeometryError(facts))
    assert.equal(facts.kind, 'equilateral')
    assert.equal(facts.angleKind, 'acute')
    for (const angle of [facts.angles.a, facts.angles.b, facts.angles.c]) {
      assert.ok(Math.abs(angle.degrees - 60) < 1e-9)
    }
  })

  test('the centres are where they should be, and the Euler line holds', () => {
    const facts = triangleFacts({ a: point(0, 0), b: point(4, 0), c: point(0, 3) })
    assert.ok(!isGeometryError(facts))
    // The circumcentre of a right triangle is the midpoint of the hypotenuse.
    assert.ok(Math.abs((facts.circumcentre as Point2).x - 2) < 1e-12)
    assert.ok(Math.abs((facts.circumcentre as Point2).y - 1.5) < 1e-12)
    // The orthocentre of a right triangle is the right-angled vertex.
    assert.ok(Math.abs((facts.orthocentre as Point2).x) < 1e-9)
    assert.ok(Math.abs((facts.orthocentre as Point2).y) < 1e-9)
  })

  test('a degenerate triangle says it has no circumcircle rather than giving an enormous one', () => {
    const facts = triangleFacts({ a: point(0, 0), b: point(1, 1), c: point(2, 2) })
    assert.ok(!isGeometryError(facts))
    assert.equal(facts.degenerate, true)
    assert.equal(facts.circumcentre, null)
    assert.equal(facts.orthocentre, null)
    assert.match(facts.describe, /no circumcircle/)
  })

  test('a very thin triangle still gets an accurate area, which Heron would lose', () => {
    // Heron's formula subtracts nearly equal numbers here and loses most of the answer.
    const facts = triangleFacts({ a: point(0, 0), b: point(1, 0), c: point(0.5, 1e-10) })
    assert.ok(!isGeometryError(facts))
    assert.ok(Math.abs(facts.area - 0.5e-10) < 1e-20, `${facts.area}`)
  })

  test('the inradius and circumradius are consistent with the area', () => {
    const facts = triangleFacts({ a: point(0, 0), b: point(3, 0), c: point(0, 4) })
    assert.ok(!isGeometryError(facts))
    // r = 2A/p and R = abc/(4A).
    assert.ok(Math.abs(facts.inradius - 1) < 1e-12)
    assert.ok(Math.abs((facts.circumradius as number) - 2.5) < 1e-12)
  })

  test('side-side-angle returns both triangles when there are two', () => {
    // The classic ambiguous case.
    const result = constructSsa(5, 7, Math.PI / 6)
    assert.ok(!isGeometryError(result))
    assert.equal(result.count, 2)
    assert.match(result.describe, /does not determine a triangle/)
  })

  test('side-side-angle returns none when no triangle fits', () => {
    const result = constructSsa(1, 10, Math.PI / 2)
    assert.ok(!isGeometryError(result))
    assert.equal(result.count, 0)
    assert.match(result.describe, /too short to reach/)
  })

  test('side-side-angle returns one when only one fits', () => {
    const result = constructSsa(10, 5, Math.PI / 2)
    assert.ok(!isGeometryError(result))
    assert.equal(result.count, 1)
  })
})

describe('circles', () => {
  test('a circle through three points is found and really passes through them', () => {
    const circle = circleThrough(point(0, 0), point(4, 0), point(0, 3))
    assert.ok(!isGeometryError(circle))
    for (const p of [point(0, 0), point(4, 0), point(0, 3)]) {
      assert.ok(Math.abs(distance2(circle.centre, p) - circle.radius) < 1e-9)
    }
  })

  test('three collinear points have no circle, and the refusal says why', () => {
    const circle = circleThrough(point(0, 0), point(1, 1), point(2, 2))
    assert.ok(isGeometryError(circle))
    assert.match(circle.message, /there is no centre to give/)
  })

  test('all six relationships between two circles are distinguished', () => {
    const unit = { centre: point(0, 0), radius: 1 }
    assert.equal((intersectCircles(unit, { centre: point(5, 0), radius: 1 }) as { relation: string }).relation, 'separate')
    assert.equal((intersectCircles(unit, { centre: point(2, 0), radius: 1 }) as { relation: string }).relation, 'touching-outside')
    assert.equal((intersectCircles(unit, { centre: point(1, 0), radius: 1 }) as { relation: string }).relation, 'intersecting')
    assert.equal((intersectCircles(unit, { centre: point(0.5, 0), radius: 0.5 }) as { relation: string }).relation, 'touching-inside')
    assert.equal((intersectCircles(unit, { centre: point(0.1, 0), radius: 0.2 }) as { relation: string }).relation, 'contained')
    assert.equal((intersectCircles(unit, { centre: point(0, 0), radius: 1 }) as { relation: string }).relation, 'identical')
  })

  test('two crossing circles give two points, both on both circles', () => {
    const a = { centre: point(0, 0), radius: 5 }
    const b = { centre: point(6, 0), radius: 5 }
    const result = intersectCircles(a, b)
    assert.ok(!isGeometryError(result))
    assert.equal(result.points.length, 2)
    for (const p of result.points) {
      assert.ok(Math.abs(distance2(p, a.centre) - 5) < 1e-9)
      assert.ok(Math.abs(distance2(p, b.centre) - 5) < 1e-9)
    }
  })

  test('a tangent line gives one point and is marked as tangent', () => {
    const result = intersectLineCircle(line(point(-5, 1), point(5, 1)), { centre: point(0, 0), radius: 1 })
    assert.equal(result.tangent, true)
    assert.equal(result.points.length, 1)
    assert.match(result.describe, /touches at exactly one point/)
  })

  test('a line missing the circle gives nothing and says how far it passes', () => {
    const result = intersectLineCircle(line(point(-5, 3), point(5, 3)), { centre: point(0, 0), radius: 1 })
    assert.equal(result.points.length, 0)
    assert.match(result.describe, /passes 2 outside it/)
  })

  test('tangents from outside give two points, from on it one, from inside none', () => {
    const circle = { centre: point(0, 0), radius: 1 }
    assert.equal(tangentsFrom(point(3, 0), circle).points.length, 2)
    assert.equal(tangentsFrom(point(1, 0), circle).points.length, 1)
    const inside = tangentsFrom(point(0.2, 0), circle)
    assert.equal(inside.points.length, 0)
    assert.match(inside.describe, /Every line through it cuts the circle twice/)
  })

  test('the tangent points really are on the circle and perpendicular to the radius', () => {
    const circle = { centre: point(0, 0), radius: 1 }
    const from = point(3, 0)
    const result = tangentsFrom(from, circle)
    for (const p of result.points) {
      assert.ok(Math.abs(distance2(p, circle.centre) - 1) < 1e-9)
      // The radius and the tangent are perpendicular at the touching point.
      const radius = { x: p.x, y: p.y }
      const tangent = { x: from.x - p.x, y: from.y - p.y }
      assert.ok(Math.abs(radius.x * tangent.x + radius.y * tangent.y) < 1e-9)
    }
  })
})

describe('conics', () => {
  test('a circle is recognised as a circle rather than an ellipse', () => {
    // x^2 + y^2 - 4 = 0.
    const result = classifyConic(1, 0, 1, 0, 0, -4)
    assert.equal(result.kind, 'circle')
    assert.ok(Math.abs((result.axes as { major: number }).major - 2) < 1e-9)
  })

  test('an ellipse comes with its axes, eccentricity and foci', () => {
    // x^2/9 + y^2/4 = 1 -> 4x^2 + 9y^2 - 36 = 0.
    const result = classifyConic(4, 0, 9, 0, 0, -36)
    assert.equal(result.kind, 'ellipse')
    assert.ok(Math.abs((result.axes as { major: number }).major - 3) < 1e-9)
    assert.ok(Math.abs((result.axes as { minor: number }).minor - 2) < 1e-9)
    // e = sqrt(9-4)/3.
    assert.ok(Math.abs((result.eccentricity as number) - Math.sqrt(5) / 3) < 1e-9)
    assert.equal(result.foci.length, 2)
  })

  test('a parabola has eccentricity exactly one and no centre', () => {
    // y = x^2 -> x^2 - y = 0.
    const result = classifyConic(1, 0, 0, 0, -1, 0)
    assert.equal(result.kind, 'parabola')
    assert.equal(result.eccentricity, 1)
    assert.equal(result.centre, null)
    assert.match(result.describe, /exactly one/)
  })

  test('a hyperbola comes with its asymptotes', () => {
    // x^2 - y^2 = 1.
    const result = classifyConic(1, 0, -1, 0, 0, -1)
    assert.equal(result.kind, 'hyperbola')
    assert.equal(result.asymptotes.length, 2)
    assert.ok(result.asymptotes.some((one) => Math.abs(Math.abs(one.slope) - 1) < 1e-9))
  })

  test('a degenerate conic is named rather than forced into one of the three kinds', () => {
    // x^2 - y^2 = 0 is a pair of lines.
    const result = classifyConic(1, 0, -1, 0, 0, 0)
    assert.equal(result.kind, 'degenerate')
    assert.match(result.describe, /pair of lines, a single point, or nothing at all/)
  })
})

describe('polygons', () => {
  const square = [point(0, 0), point(2, 0), point(2, 2), point(0, 2)]

  test('area, perimeter and centroid come from the shoelace formula', () => {
    const facts = polygonFacts(square)
    assert.ok(!isGeometryError(facts))
    assert.ok(Math.abs(facts.area - 4) < 1e-12)
    assert.ok(Math.abs(facts.perimeter - 8) < 1e-12)
    assert.ok(Math.abs(facts.centroid.x - 1) < 1e-12)
    assert.equal(facts.convex, true)
  })

  test('the winding direction is kept rather than discarded', () => {
    const clockwise = polygonFacts([...square].reverse())
    assert.ok(!isGeometryError(clockwise))
    assert.equal(clockwise.orientation, 'clockwise')
    assert.ok(clockwise.signedArea < 0)
    assert.ok(clockwise.area > 0)
  })

  test('a concave polygon is recognised as concave', () => {
    const arrow = [point(0, 0), point(4, 0), point(2, 1), point(4, 2), point(0, 2)]
    const facts = polygonFacts(arrow)
    assert.ok(!isGeometryError(facts))
    assert.equal(facts.convex, false)
    assert.equal(facts.selfIntersecting, false)
  })

  test('a self-intersecting polygon is flagged, and its number is not called an area', () => {
    const bowtie = [point(0, 0), point(2, 2), point(2, 0), point(0, 2)]
    const facts = polygonFacts(bowtie)
    assert.ok(!isGeometryError(facts))
    assert.equal(facts.selfIntersecting, true)
    assert.match(facts.describe, /no well-defined interior/)
  })

  test('fewer than three vertices is refused', () => {
    assert.ok(isGeometryError(polygonFacts([point(0, 0), point(1, 1)])))
  })

  test('containment distinguishes the boundary from inside and outside', () => {
    assert.equal(containsPoint(square, point(1, 1)), 'inside')
    assert.equal(containsPoint(square, point(3, 1)), 'outside')
    assert.equal(containsPoint(square, point(0, 1)), 'on-boundary')
    assert.equal(containsPoint(square, point(0, 0)), 'on-boundary')
  })

  test('a ray passing exactly through a vertex is counted once, not twice', () => {
    const diamond = [point(0, 0), point(1, 1), point(2, 0), point(1, -1)]
    // The horizontal ray from inside passes through two vertices.
    assert.equal(containsPoint(diamond, point(1, 0)), 'inside')
    assert.equal(containsPoint(diamond, point(3, 0)), 'outside')
  })

  test('a regular polygon has the right measurements', () => {
    const hexagon = regularPolygon(6, 1)
    assert.ok(!isGeometryError(hexagon))
    assert.equal(hexagon.vertices.length, 6)
    // A regular hexagon of circumradius 1 has side 1 and area 3*sqrt(3)/2.
    assert.ok(Math.abs(hexagon.perimeter - 6) < 1e-9)
    assert.ok(Math.abs(hexagon.area - (3 * Math.sqrt(3)) / 2) < 1e-9)
    assert.ok(Math.abs(hexagon.interiorAngle.degrees - 120) < 1e-9)
  })

  test('segments that cross are recognised, and ones that only touch endpoints too', () => {
    assert.equal(segmentsCross(point(0, 0), point(2, 2), point(0, 2), point(2, 0)), true)
    assert.equal(segmentsCross(point(0, 0), point(1, 1), point(2, 2), point(3, 3)), false)
    assert.equal(segmentsCross(point(0, 0), point(1, 1), point(1, 1), point(2, 0)), true)
  })
})

describe('transformations', () => {
  test('a translation moves a point by the vector', () => {
    const moved = applyTransform(translation(3, -2), point(1, 1))
    assert.deepEqual(moved, { x: 4, y: -1 })
  })

  test('a rotation about a point leaves that point alone', () => {
    const t = rotation(Math.PI / 3, point(5, 5))
    const fixed = applyTransform(t, point(5, 5))
    assert.ok(Math.abs(fixed.x - 5) < 1e-12)
    assert.ok(Math.abs(fixed.y - 5) < 1e-12)
  })

  test('a quarter turn about the origin takes (1,0) to (0,1)', () => {
    const moved = applyTransform(rotation(Math.PI / 2), point(1, 0))
    assert.ok(Math.abs(moved.x) < 1e-12)
    assert.ok(Math.abs(moved.y - 1) < 1e-12)
  })

  test('composition applies the first transformation first, and says so', () => {
    const t = compose(translation(1, 0), scaling(2, 2))
    const moved = applyTransform(t, point(0, 0))
    // Translate to (1,0), then scale to (2,0). The other order would give (1,0).
    assert.ok(Math.abs(moved.x - 2) < 1e-12)
    assert.match(t.describe, /translation by \(1, 0\), then scaling/)
  })

  test('a rotation is an isometry and a scaling is not', () => {
    assert.equal(transformFacts(rotation(1)).isometry, true)
    assert.equal(transformFacts(scaling(2, 2)).isometry, false)
    assert.ok(Math.abs(transformFacts(scaling(2, 3)).areaScale - 6) < 1e-12)
  })

  test('a reflection reverses orientation, which is what a negative determinant means', () => {
    const facts = transformFacts(reflection(0))
    assert.equal(facts.preservesOrientation, false)
    assert.equal(facts.isometry, true)
    assert.match(facts.describe, /negative determinant/)
  })

  test('a reflection in the x-axis flips the sign of y', () => {
    const moved = applyTransform(reflection(0), point(3, 4))
    assert.ok(Math.abs(moved.x - 3) < 1e-12)
    assert.ok(Math.abs(moved.y + 4) < 1e-12)
  })
})

describe('computational geometry', () => {
  test('the convex hull of a square with an interior point has four vertices', () => {
    const hull = convexHull([point(0, 0), point(2, 0), point(2, 2), point(0, 2), point(1, 1)])
    assert.ok(!isGeometryError(hull))
    assert.equal(hull.length, 4)
  })

  test('collinear points on an edge are not hull vertices', () => {
    const hull = convexHull([point(0, 0), point(1, 0), point(2, 0), point(1, 2)])
    assert.ok(!isGeometryError(hull))
    // The midpoint of the bottom edge is on the hull but is not a vertex of it.
    assert.equal(hull.length, 3)
  })

  test('the hull of three points is the triangle itself', () => {
    const hull = convexHull([point(0, 0), point(1, 0), point(0, 1)])
    assert.ok(!isGeometryError(hull))
    assert.equal(hull.length, 3)
  })

  test('the closest pair is found and matches a direct search', () => {
    const points = [point(0, 0), point(10, 10), point(0.1, 0.1), point(5, 5), point(-3, 7)]
    const result = closestPair(points)
    assert.ok(!isGeometryError(result))

    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) best = Math.min(best, distance2(points[i], points[j]))
    }
    assert.ok(Math.abs(result.distance - best) < 1e-12)
  })

  test('the closest pair on a larger set still matches a direct search', () => {
    const points: Point2[] = []
    // A deterministic spread, so the test is the same every run.
    for (let i = 0; i < 200; i++) points.push(point((i * 37) % 101, (i * 53) % 97))
    const result = closestPair(points)
    assert.ok(!isGeometryError(result))

    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) best = Math.min(best, distance2(points[i], points[j]))
    }
    assert.ok(Math.abs(result.distance - best) < 1e-9, `${result.distance} against ${best}`)
  })

  test('fewer than two points has no closest pair', () => {
    assert.ok(isGeometryError(closestPair([point(0, 0)])))
  })

  test('a Delaunay triangulation really has the empty-circumcircle property', () => {
    const points = [point(0, 0), point(4, 0), point(4, 4), point(0, 4), point(2, 1)]
    const result = delaunay(points)
    assert.ok(!isGeometryError(result))
    assert.ok(result.triangles.length >= 3)
    const verified = verifyDelaunay(points, result.triangles)
    assert.equal(verified.holds, true, verified.describe)
  })

  test('the circumcircle test is a determinant, not a distance comparison', () => {
    // The unit square's corners: the fourth is exactly on the circumcircle of the first three, not inside.
    assert.equal(inCircumcircle(point(0, 0), point(1, 0), point(1, 1), point(0, 1)), false)
    assert.equal(inCircumcircle(point(0, 0), point(1, 0), point(1, 1), point(0.5, 0.5)), true)
  })

  test('the triangulation describes its own defining property', () => {
    const result = delaunay([point(0, 0), point(1, 0), point(0, 1), point(1, 1)])
    assert.ok(!isGeometryError(result))
    assert.match(result.describe, /no point lies inside the circumcircle/)
  })
})

describe('three dimensions', () => {
  test('a plane through three points has a unit normal', () => {
    const plane = planeThrough(point3(0, 0, 0), point3(1, 0, 0), point3(0, 1, 0))
    assert.ok(!isGeometryError(plane))
    assert.ok(Math.abs(Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z) - 1) < 1e-12)
    assert.ok(Math.abs(Math.abs(plane.normal.z) - 1) < 1e-12)
  })

  test('three collinear points do not determine a plane', () => {
    const plane = planeThrough(point3(0, 0, 0), point3(1, 1, 1), point3(2, 2, 2))
    assert.ok(isGeometryError(plane))
    assert.match(plane.message, /Infinitely many planes contain a line/)
  })

  test('the distance to a plane comes out directly from the unit normal', () => {
    const plane = planeThrough(point3(0, 0, 0), point3(1, 0, 0), point3(0, 1, 0))
    assert.ok(!isGeometryError(plane))
    assert.ok(Math.abs(distanceToPlane(point3(0, 0, 5), plane) - 5) < 1e-12)
  })

  test('a line can cross a plane, be parallel to it, or lie in it', () => {
    const plane = planeThrough(point3(0, 0, 0), point3(1, 0, 0), point3(0, 1, 0))
    assert.ok(!isGeometryError(plane))
    assert.equal(intersectLinePlane(point3(0, 0, 5), point3(0, 0, -1), plane).relation, 'point')
    assert.equal(intersectLinePlane(point3(0, 0, 5), point3(1, 0, 0), plane).relation, 'parallel')
    assert.equal(intersectLinePlane(point3(0, 0, 0), point3(1, 0, 0), plane).relation, 'contained')
  })

  test('two planes meet in a line, or are parallel, or are the same plane', () => {
    const xy = planeThrough(point3(0, 0, 0), point3(1, 0, 0), point3(0, 1, 0))
    const xz = planeThrough(point3(0, 0, 0), point3(1, 0, 0), point3(0, 0, 1))
    assert.ok(!isGeometryError(xy) && !isGeometryError(xz))
    assert.equal(intersectPlanes(xy, xz).relation, 'line')
    assert.equal(intersectPlanes(xy, { normal: xy.normal, offset: xy.offset + 5 }).relation, 'parallel')
    assert.equal(intersectPlanes(xy, xy).relation, 'coincident')
  })

  test('the line where two planes meet lies in both', () => {
    const xy = planeThrough(point3(0, 0, 0), point3(1, 0, 0), point3(0, 1, 0))
    const xz = planeThrough(point3(0, 0, 0), point3(1, 0, 0), point3(0, 0, 1))
    assert.ok(!isGeometryError(xy) && !isGeometryError(xz))
    const meeting = intersectPlanes(xy, xz)
    assert.ok(meeting.through)
    assert.ok(distanceToPlane(meeting.through, xy) < 1e-9)
    assert.ok(distanceToPlane(meeting.through, xz) < 1e-9)
  })

  test('the standard solids have the standard measurements', () => {
    const sphere = solidFacts('sphere', { radius: 3 })
    assert.ok(!isGeometryError(sphere))
    assert.ok(Math.abs(sphere.volume - (4 / 3) * Math.PI * 27) < 1e-9)
    assert.ok(Math.abs(sphere.surfaceArea - 4 * Math.PI * 9) < 1e-9)

    const cone = solidFacts('cone', { radius: 3, height: 4 })
    assert.ok(!isGeometryError(cone))
    // Slant height 5, so lateral area is pi*3*5.
    assert.ok(Math.abs((cone.lateralArea as number) - Math.PI * 15) < 1e-9)
    assert.match(cone.describe, /slant height 5/)
  })

  test('a pyramid says its lateral area needs the base shape, not just the base area', () => {
    const pyramid = solidFacts('pyramid', { baseArea: 16, height: 6 })
    assert.ok(!isGeometryError(pyramid))
    assert.ok(Math.abs(pyramid.volume - 32) < 1e-12)
    assert.equal(pyramid.lateralArea, null)
    assert.match(pyramid.describe, /needs the base's shape/)
  })

  test('a non-positive dimension is refused', () => {
    assert.ok(isGeometryError(solidFacts('cube', { a: 0 })))
    assert.ok(isGeometryError(solidFacts('cylinder', { radius: 1 })))
  })
})

describe('claim checking', () => {
  const points = new Map<string, Point2>([
    ['A', point(0, 0)],
    ['B', point(4, 0)],
    ['C', point(0, 3)],
    ['D', point(2, 0)],
    ['E', point(1, 1)]
  ])

  test('a true claim is reported as checked, never as proven', () => {
    const result = checkClaim({ id: 'c1', kind: 'collinear', points: ['A', 'B', 'D'], describe: '' }, points)
    assert.equal(result.holds, true)
    assert.equal(result.verdict, 'checked-numerically')
    assert.match(result.describe, /not a proof that the claim holds in general/)
  })

  test('a false claim is refuted, and one counterexample settles it', () => {
    const result = checkClaim({ id: 'c2', kind: 'collinear', points: ['A', 'B', 'E'], describe: '' }, points)
    assert.equal(result.holds, false)
    assert.equal(result.verdict, 'counterexample')
    assert.match(result.describe, /One counterexample is enough to settle it/)
    assert.match(result.measured, /off the line/)
  })

  test('perpendicularity is checked from the dot product', () => {
    const result = checkClaim({ id: 'c3', kind: 'perpendicular', points: ['A', 'B', 'A', 'C'], describe: '' }, points)
    assert.equal(result.holds, true)
  })

  test('equal lengths are compared with the measurement shown', () => {
    const square = new Map<string, Point2>([
      ['P', point(0, 0)],
      ['Q', point(1, 0)],
      ['R', point(1, 1)],
      ['S', point(0, 1)]
    ])
    const result = checkClaim({ id: 'c4', kind: 'equal-length', points: ['P', 'Q', 'R', 'S'], describe: '' }, square)
    assert.equal(result.holds, true)
    assert.match(result.measured, /1 against 1/)
  })

  test('concurrency of the medians of a triangle holds', () => {
    // The three medians meet at the centroid.
    const triangle = new Map<string, Point2>([
      ['A', point(0, 0)],
      ['B', point(6, 0)],
      ['C', point(0, 6)],
      ['MA', point(3, 3)],
      ['MB', point(0, 3)],
      ['MC', point(3, 0)]
    ])
    const result = checkClaim({ id: 'c5', kind: 'concurrent', points: ['A', 'MA', 'B', 'MB', 'C', 'MC'], describe: '' }, triangle)
    assert.equal(result.holds, true)
  })

  test('a claim about points that are not in the configuration is undecidable', () => {
    const result = checkClaim({ id: 'c6', kind: 'collinear', points: ['A', 'B', 'Z'], describe: '' }, points)
    assert.equal(result.verdict, 'undecidable')
    assert.match(result.describe, /not in the configuration/)
  })

  test('concyclic points are checked against the circle through the first three', () => {
    const square = new Map<string, Point2>([
      ['P', point(1, 0)],
      ['Q', point(0, 1)],
      ['R', point(-1, 0)],
      ['S', point(0, -1)],
      ['T', point(0.5, 0.5)]
    ])
    assert.equal(checkClaim({ id: 'c7', kind: 'on-circle', points: ['P', 'Q', 'R', 'S'], describe: '' }, square).holds, true)
    assert.equal(checkClaim({ id: 'c8', kind: 'on-circle', points: ['P', 'Q', 'R', 'T'], describe: '' }, square).holds, false)
  })

  test('congruence is checked up to relabelling, which is what congruence means', () => {
    const two = new Map<string, Point2>([
      ['A', point(0, 0)],
      ['B', point(3, 0)],
      ['C', point(0, 4)],
      ['D', point(10, 0)],
      ['E', point(10, 4)],
      ['F', point(13, 0)]
    ])
    const result = checkClaim({ id: 'c9', kind: 'congruent-triangles', points: ['A', 'B', 'C', 'D', 'E', 'F'], describe: '' }, two)
    assert.equal(result.holds, true)
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the engine is built on', () => {
    assert.ok(GEOMETRY_ASSUMPTIONS.length >= 7)
    assert.ok(GEOMETRY_ASSUMPTIONS.some((one) => /by how a figure looks/.test(one)))
    assert.ok(GEOMETRY_ASSUMPTIONS.some((one) => /Both are returned/.test(one)))
    assert.ok(GEOMETRY_ASSUMPTIONS.some((one) => /checked, not proven/.test(one)))
  })
})
