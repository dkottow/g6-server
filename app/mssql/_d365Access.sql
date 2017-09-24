CREATE PROCEDURE [dbo].[_d365Access] 
	-- Add the parameters for the stored procedure here
	@UserPrincipalName varchar(256),
	@TableName varchar(256) = null,
	@Read varchar(16) OUTPUT,
	@Write varchar(16) OUTPUT,
	@Principal varchar(256) OUTPUT
AS
BEGIN
	
	DECLARE @ur varchar(16), @uw varchar(16)
	DECLARE @tr varchar(16), @tw varchar(16)
	SET NOCOUNT ON;

	-- get user-specific database access
	SELECT TOP 1 @ur = [Read], @uw = [Write], @Principal = [Principal] FROM 
	(
	-- Option 1: UserPrincipalName exists in __d365Principals
		SELECT 1 as ord, AR.[Name] as [Read], AW.[Name] as [Write], U.[Name] as Principal 
        FROM _d365Principals U 
		INNER JOIN _d365AccessScope AR ON U.Read_id = AR.id
		INNER JOIN _d365AccessScope AW ON U.Write_id = AW.id
		WHERE U.[Name] = @UserPrincipalName

	UNION
	-- Option 2: UserPrincipalName is listed in __d365UserPrincipal
		SELECT 2 as ord, AR.[Name] as [Read], AW.[Name] as [Write], U.[Name] as Principal 
        FROM _d365Principals U 
		INNER JOIN _d365UserPrincipal UP ON U.id = UP.Principal_id
		INNER JOIN _d365AccessScope AR ON U.Read_id = AR.id
		INNER JOIN _d365AccessScope AW ON U.Write_id = AW.id
		WHERE UP.UserPrincipalName = @UserPrincipalName

	UNION
	-- Option 3: UserPrincipalName is not listed anywhere but Principal 'Everyone' exists in __d365Principals
		SELECT 3 as ord, AR.[Name] as [Read], AW.[Name] as [Write], U.[Name] as Principal 
        FROM _d365Principals U 
		INNER JOIN _d365AccessScope AR ON U.Read_id = AR.id
		INNER JOIN _d365AccessScope AW ON U.Write_id = AW.id
		WHERE U.[Name] = 'Everyone'

	) AS T order by ord;

	-- check if table-specific access exists
	IF @ur is not null and @TableName is not null BEGIN
		SELECT @tr = AR.[Name], @tw = AW.[Name] 
        FROM _d365TableAccess  T 
		INNER JOIN _d365AccessScope AR ON T.Read_id = AR.id
		INNER JOIN _d365AccessScope AW ON T.Write_id = AW.id
		WHERE TableName = @TableName;
	END 

	-- table-specific access overwrites user-specific access
	SET @Read = COALESCE(@tr, @ur, 'none');
	SET @Write = COALESCE(@tw, @uw, 'none');

END
