#include "circle.h"
bool circle_contains(int x, int y) {
    if (x < 0 || y < 0 || x >= 466 || y >= 466) return false;
    /* Pixel centers relative to the center of the 466-pixel square. */
    int dx = 2 * x + 1 - 466, dy = 2 * y + 1 - 466;
    return dx * dx + dy * dy <= 466 * 466;
}
