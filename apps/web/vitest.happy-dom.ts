// happy-dom has no ElementInternals: the Skin's form Composants (cd-select,
// cd-text-field…) attach theirs in their constructor. This stub lets the page's
// tests render them; their behaviour as form controls is proven in a real
// Chromium, by the Skin's own tests and the end-to-end specs.
if (!('attachInternals' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'attachInternals', {
    configurable: true,
    value(): Partial<ElementInternals> {
      return {
        form: null,
        validity: { valid: true } as ValidityState,
        validationMessage: '',
        checkValidity: () => true,
        reportValidity: () => true,
        setFormValue: () => undefined,
        setValidity: () => undefined,
      };
    },
  });
}
