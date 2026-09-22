#include <iostream>

int main() {
    long long a;
    long long b;
    if (!(std::cin >> a >> b)) return 0;
    std::cout << a - b << '\n';
    return 0;
}
