from runtime.mcp.slug import is_valid_slug, slugify_display_name


def test_slugify_display_name_suffixes_collisions():
    assert slugify_display_name("My Linear", set()) == "my_linear"
    assert slugify_display_name("My Linear", {"my_linear"}) == "my_linear_2"


def test_validates_slug_pattern():
    assert is_valid_slug("linear_2")
    assert not is_valid_slug("Linear-2")
    assert not is_valid_slug("x" * 33)
