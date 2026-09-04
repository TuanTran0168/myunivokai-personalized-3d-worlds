package repositories

import (
	"context"
	"encoding/json"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
)

// The three list columns are JSONB and cross this boundary as JSON text.
// emptyJSONList is what a nil or empty slice is written as, so a row always
// holds a readable array rather than SQL NULL - the migration's own DEFAULT
// says the same thing, and this keeps an explicit write agreeing with it.
const emptyJSONList = "[]"

func (store *PostgresStore) GetAccountProfile(ctx context.Context, accountID string) (AccountProfile, error) {
	var profile AccountProfile
	var gender, preferredWorldFamily string
	var interestsJSON, traitsJSON, favoriteColorsJSON []byte
	err := store.pool.QueryRow(ctx, `SELECT account_id::text, full_name, gender, preferred_world_family, preferred_world_style,
			primary_role, goal, challenge, mood, interests, traits, favorite_colors, autofill_create_form, created_at, updated_at
		FROM account_profiles WHERE account_id = $1`, accountID,
	).Scan(&profile.AccountID, &profile.FullName, &gender, &preferredWorldFamily, &profile.PreferredWorldStyle,
		&profile.PrimaryRole, &profile.Goal, &profile.Challenge, &profile.Mood,
		&interestsJSON, &traitsJSON, &favoriteColorsJSON, &profile.AutofillCreateForm, &profile.CreatedAt, &profile.UpdatedAt)
	if err != nil {
		return AccountProfile{}, mapNotFound(err)
	}
	profile.Gender = contracts.AccountGender(gender)
	profile.PreferredWorldFamily = contracts.WorldFamily(preferredWorldFamily)
	if profile.Interests, err = decodeStringList(interestsJSON); err != nil {
		return AccountProfile{}, err
	}
	if profile.Traits, err = decodeStringList(traitsJSON); err != nil {
		return AccountProfile{}, err
	}
	if profile.FavoriteColors, err = decodeStringList(favoriteColorsJSON); err != nil {
		return AccountProfile{}, err
	}
	return profile, nil
}

// UpsertAccountProfile creates the row on first save and replaces it after
// that. ON CONFLICT rather than a read-then-branch: two tabs saving the same
// profile at once would otherwise race to insert, and the second would get a
// primary-key violation instead of saving.
//
// created_at is left alone by the update, so the row keeps saying when the
// account first filled its page in.
func (store *PostgresStore) UpsertAccountProfile(ctx context.Context, profile AccountProfile) (AccountProfile, error) {
	interestsJSON, err := encodeStringList(profile.Interests)
	if err != nil {
		return AccountProfile{}, err
	}
	traitsJSON, err := encodeStringList(profile.Traits)
	if err != nil {
		return AccountProfile{}, err
	}
	favoriteColorsJSON, err := encodeStringList(profile.FavoriteColors)
	if err != nil {
		return AccountProfile{}, err
	}
	_, err = store.pool.Exec(ctx, `INSERT INTO account_profiles
			(account_id, full_name, gender, preferred_world_family, preferred_world_style,
			 primary_role, goal, challenge, mood, interests, traits, favorite_colors, autofill_create_form)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (account_id) DO UPDATE SET
			full_name = EXCLUDED.full_name,
			gender = EXCLUDED.gender,
			preferred_world_family = EXCLUDED.preferred_world_family,
			preferred_world_style = EXCLUDED.preferred_world_style,
			primary_role = EXCLUDED.primary_role,
			goal = EXCLUDED.goal,
			challenge = EXCLUDED.challenge,
			mood = EXCLUDED.mood,
			interests = EXCLUDED.interests,
			traits = EXCLUDED.traits,
			favorite_colors = EXCLUDED.favorite_colors,
			autofill_create_form = EXCLUDED.autofill_create_form,
			updated_at = NOW()`,
		profile.AccountID, profile.FullName, string(profile.Gender), string(profile.PreferredWorldFamily), profile.PreferredWorldStyle,
		profile.PrimaryRole, profile.Goal, profile.Challenge, profile.Mood,
		interestsJSON, traitsJSON, favoriteColorsJSON, profile.AutofillCreateForm)
	if err != nil {
		return AccountProfile{}, mapConstraintViolation(err)
	}
	return store.GetAccountProfile(ctx, profile.AccountID)
}

func (store *PostgresStore) SetAccountDisplayName(ctx context.Context, accountID, name string) (Account, error) {
	if _, err := store.pool.Exec(ctx, `UPDATE accounts SET name = $2, updated_at = NOW() WHERE id = $1`, accountID, name); err != nil {
		return Account{}, mapConstraintViolation(err)
	}
	return store.GetAccountByID(ctx, accountID)
}

// decodeStringList never returns nil on success: an empty JSONB array and an
// absent one are the same fact, and a nil slice would let that difference
// reach a caller that has no use for it.
func decodeStringList(rawJSON []byte) ([]string, error) {
	if len(rawJSON) == 0 {
		return []string{}, nil
	}
	var values []string
	if err := json.Unmarshal(rawJSON, &values); err != nil {
		return nil, err
	}
	if values == nil {
		return []string{}, nil
	}
	return values, nil
}

func encodeStringList(values []string) (string, error) {
	if len(values) == 0 {
		return emptyJSONList, nil
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
