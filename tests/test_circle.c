#include "circle.h"
#include <assert.h>
int main(void) {
    assert(circle_contains(233, 233));
    assert(circle_contains(233, 0));
    assert(!circle_contains(0, 0));
    assert(!circle_contains(-1, 233));
    assert(!circle_contains(466, 233));
    return 0;
}
