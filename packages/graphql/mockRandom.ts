let counter = 1;
beforeEach(() => {
    counter = 1;
});
jest.mock("randomstring", () => ({ generate: () => "RandomString" + counter++ }));
