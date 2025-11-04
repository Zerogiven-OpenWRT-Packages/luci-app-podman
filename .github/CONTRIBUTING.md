# Contributing to LuCI App Podman

Thank you for considering contributing to this project!

## Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following our code standards
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to your branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## Code Standards

### JavaScript
- Use modern ES6+ syntax (const/let, arrow functions, template literals)
- Use `function` keyword for lifecycle methods (`load`, `render`, etc.)
- Use arrow functions for callbacks and event handlers
- Follow existing LuCI patterns (form components, ui.showModal, etc.)
- Keep JSDoc comments concise but informative
- Minimize inline comments - write self-documenting code

### Backend (Shell)
- Follow existing RPC method patterns
- Add proper error handling
- Test with `ubus call` before committing

### Documentation
- Keep comments short and informative
- Update README.md for user-facing changes
- Update CLAUDE.md for developer patterns

## Code Quality Checklist

- [ ] Uses official LuCI components (no custom HTML tables)
- [ ] Proper error handling with user notifications
- [ ] All strings wrapped in `_()`  for translation
- [ ] No debug/console.log statements
- [ ] Works on actual OpenWrt device
- [ ] ACL permissions updated if adding RPC methods

## Testing

```bash
# Test RPC backend
ubus call luci.podman containers_list '{"query":"all=true"}'

# Monitor logs
logread -f | grep luci.podman
```

## Pull Request Guidelines

- One feature per PR
- Clear, descriptive commit messages
- Reference related issues if applicable
- Ensure no breaking changes without discussion

## Questions?

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Join discussions on open PRs

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
