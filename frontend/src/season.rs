pub fn valid_season(value: &str) -> bool {
    let parts: Vec<_> = value.split('/').collect();
    if parts.is_empty()
        || parts.len() > 2
        || parts[0].len() != 4
        || !parts[0].bytes().all(|b| b.is_ascii_digit())
    {
        return false;
    }
    let year = parts[0].parse::<u16>().unwrap_or(0);
    if !(1900..=2100).contains(&year) {
        return false;
    }
    if parts.len() == 1 {
        return true;
    }
    let second = parts[1];
    if ![2, 4].contains(&second.len()) || !second.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let end = second.parse::<u16>().unwrap_or(0);
    if second.len() == 2 {
        end == (year + 1) % 100 || end == year % 100
    } else {
        end == year || end == year + 1
    }
}
#[cfg(test)]
mod tests {
    use super::valid_season;
    #[test]
    fn validates_years_and_seasons() {
        for year in ["2025", "2025/26", "2025/2026", "1999/00", "2025/25"] {
            assert!(valid_season(year), "{year}");
        }
        for year in [
            "",
            "202",
            "2025/27",
            "2025/",
            "20xx",
            "2025/26/27",
            "1899",
            "2025/2020",
        ] {
            assert!(!valid_season(year), "{year}");
        }
    }
}
