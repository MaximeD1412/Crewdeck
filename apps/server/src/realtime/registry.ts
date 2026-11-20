/**
 * A multi-provider, as Nest has none: the token's value is a `Registry`, each
 * module adds its item to it when it starts (`onModuleInit`), its readers
 * read `all()` once the app is up.
 */
export class Registry<T> {
  private readonly items: T[] = [];

  add(item: T): void {
    this.items.push(item);
  }

  /** Removes `item`, when it was added. */
  remove(item: T): void {
    const index = this.items.indexOf(item);
    if (index >= 0) this.items.splice(index, 1);
  }

  all(): readonly T[] {
    return this.items;
  }
}
